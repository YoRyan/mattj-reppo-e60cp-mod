import * as frp from "lib/frp";
import { FrpEngine } from "lib/frp-engine";
import { mapBehavior, rejectRepeats, rejectUndefined } from "lib/frp-extra";
import * as rw from "lib/railworks";

/**
 * A pulse code frequency combination in use on the Northeast Corridor.
 */
enum PulseCode {
    C_0_0,
    C_75_0,
    C_75_75,
    C_120_0,
    C_120_120,
    C_180_0,
    C_180_180,
    C_270_0,
    C_270_270,
    C_420_0,
}

enum Aspect {
    Restricting = "M14",
    Approach = "M12",
    ApproachLimited = "M11",
    Clear = "M10",
}

enum PlatformHeight {
    Low,
    HighNoAlarm,
    HighWithAlarm,
}

const brakeMessageId = 10101;
const lowPlatformMessageId = 10146;
const lowPlatformRepeatS = 5;

// Load and executes the old code. Requires the .out file to be extracted from
// the asset pack!
require("Assets/Reppo/E60CP/RailVehicles/Scripts/E60_EngineScript.out");
// Save the old signal message handler.
const oldOnCustomSignalMessage = OnCustomSignalMessage;

const me = new FrpEngine(() => {
    // Universal signal message translator
    const forwardSignalMessage$ = frp.compose(
        me.createOnSignalMessageStream(),
        frp.map(toPulseCode),
        rejectUndefined(),
        frp.map(pc => {
            return {
                [PulseCode.C_0_0]: Aspect.Restricting,
                [PulseCode.C_75_0]: Aspect.Approach,
                [PulseCode.C_75_75]: Aspect.Approach,
                [PulseCode.C_120_0]: Aspect.ApproachLimited,
                [PulseCode.C_120_120]: Aspect.ApproachLimited,
                [PulseCode.C_180_0]: Aspect.Clear,
                [PulseCode.C_180_180]: Aspect.Clear,
                [PulseCode.C_270_0]: Aspect.ApproachLimited,
                [PulseCode.C_270_270]: Aspect.Clear,
                [PulseCode.C_420_0]: Aspect.ApproachLimited,
            }[pc];
        })
    );
    forwardSignalMessage$(msg => {
        oldOnCustomSignalMessage(msg);
    });

    // Consist message for brake indicator lights
    const sendBrakeMessage$ = frp.compose(
        me.createPlayerWithKeyUpdateStream(),
        frp.throttle(500),
        frp.map(_ => {
            const brakeValue = me.rv.GetControlValue("TrainBrakeControl", 0) as number;
            const psi = me.rv.GetControlValue("AirBrakePipePressurePSI", 0) as number;
            return string.format("%.3f10101%03d", brakeValue, psi);
        })
    );
    sendBrakeMessage$(msg => {
        me.rv.SendConsistMessage(brakeMessageId, msg, rw.ConsistDirection.Forward);
        me.rv.SendConsistMessage(brakeMessageId, msg, rw.ConsistDirection.Backward);
    });

    // Low-platform trapdoor toggle
    const platformHeightChange$ = frp.compose(
        me.createOnCvChangeStreamFor("AmfleetDoorLevel", 0),
        frp.map(toPlatformHeight),
        rejectRepeats()
    );
    const platformHeightUpdate$ = frp.compose(
        me.createPlayerWithKeyUpdateStream(),
        frp.throttle(lowPlatformRepeatS * 1000),
        me.mapGetCvStream("AmfleetDoorLevel", 0),
        rejectUndefined(),
        frp.map(toPlatformHeight)
    );
    platformHeightChange$(height => {
        const status = {
            [PlatformHeight.Low]: "Low-Floor",
            [PlatformHeight.HighNoAlarm]: "High-Floor Manual",
            [PlatformHeight.HighWithAlarm]: "High-Floor Auto",
        }[height];
        rw.ScenarioManager.ShowMessage("Door Platform Height", status, rw.MessageBox.Alert);
    });

    // Consist message for low-platform trapdoors
    const sendLowPlatformMessage$ = frp.compose(
        platformHeightChange$,
        frp.merge(platformHeightUpdate$),
        frp.map(height => height === PlatformHeight.Low)
    );
    sendLowPlatformMessage$(isLow => {
        const msg = isLow ? "1" : "0";
        me.rv.SendConsistMessage(lowPlatformMessageId, msg, rw.ConsistDirection.Forward);
        me.rv.SendConsistMessage(lowPlatformMessageId, msg, rw.ConsistDirection.Backward);
    });
});
me.setup();

/**
 * Attempt to convert a signal message to a pulse code.
 * @param signalMessage The custom signal message.
 * @returns The pulse code, if one matches.
 */
function toPulseCode(signalMessage: string) {
    // Signals scripted by Brandon Phelan.
    const [, , sig, speed] = string.find(signalMessage, "^sig(%d)speed(%d+)$");
    if (sig === "1" && speed == "150") {
        return PulseCode.C_180_180;
    } else if (sig === "1" && speed == "100") {
        return PulseCode.C_270_270;
    } else if (sig === "1") {
        return PulseCode.C_180_0;
    } else if (sig === "2") {
        return PulseCode.C_120_120;
    } else if (sig === "3") {
        return PulseCode.C_270_0;
    } else if (sig === "4") {
        return PulseCode.C_120_0;
    } else if (sig === "5") {
        return PulseCode.C_75_75;
    } else if (sig === "6") {
        return PulseCode.C_75_0;
    } else if (sig === "7" && speed === "60") {
        return PulseCode.C_420_0;
    } else if (sig === "7") {
        return PulseCode.C_0_0;
    }
    const [, , stop] = string.find(signalMessage, "^sig7stop(%d+)$");
    if (stop !== undefined) {
        return PulseCode.C_0_0;
    }

    // Signals scripted by DTG for Amtrak and NJ Transit DLC's.
    const [, , sig2] = string.find(signalMessage, "^sig(%d+)");
    if (sig2 === "1") {
        return PulseCode.C_180_0;
    } else if (sig2 === "2") {
        return PulseCode.C_120_120;
    } else if (sig2 === "3") {
        return PulseCode.C_270_0;
    } else if (sig2 === "4") {
        return PulseCode.C_120_0;
    } else if (sig2 === "5") {
        return PulseCode.C_75_75;
    } else if (sig2 === "6") {
        return PulseCode.C_75_0;
    } else if (sig2 === "7") {
        return PulseCode.C_0_0;
    }

    // Signals scripted by DTG for Metro-North DLC's.
    const [, , code] = string.find(signalMessage, "^[MN](%d%d)");
    if (code === "10") {
        return PulseCode.C_180_0;
    } else if (code === "11") {
        return PulseCode.C_120_0;
    } else if (code === "12") {
        return PulseCode.C_75_0;
    } else if (code === "13" || code === "14") {
        return PulseCode.C_0_0;
    } else if (code === "15") {
        return PulseCode.C_0_0;
    }

    return undefined;
}

/**
 * Read a platform height enum from the control value.
 */
function toPlatformHeight(v: number) {
    if (v > 1.5) {
        return PlatformHeight.HighWithAlarm;
    } else if (v > 0.5) {
        return PlatformHeight.HighNoAlarm;
    } else {
        return PlatformHeight.Low;
    }
}
