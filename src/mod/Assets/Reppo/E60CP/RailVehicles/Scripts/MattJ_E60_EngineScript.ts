/** @noSelfInFile */

require("Assets/Reppo/E60CP/RailVehicles/Scripts/E60_EngineScript.out");

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

const oldOnSignalMessage = OnCustomSignalMessage;
OnCustomSignalMessage = msg => {
    const pulseCode = toPulseCode(msg);
    if (pulseCode !== undefined) {
        const emulatedMsg = {
            [PulseCode.C_0_0]: "M15",
            [PulseCode.C_75_0]: "M12",
            [PulseCode.C_75_75]: "M12",
            [PulseCode.C_120_0]: "M11",
            [PulseCode.C_120_120]: "M11",
            [PulseCode.C_180_0]: "M10",
            [PulseCode.C_180_180]: "M10",
            // Prototypically, an E60 cannot understand the following codes and would interpret them as Restricting.
            [PulseCode.C_270_0]: "M15",
            [PulseCode.C_270_270]: "M15",
            [PulseCode.C_420_0]: "M15",
        }[pulseCode];
        oldOnSignalMessage(emulatedMsg);
    }
};
