/** @noSelfInFile */

import * as c from "lib/constants";
import * as frp from "lib/frp";
import { mapBehavior, mergeBeforeStart, once, rejectRepeats } from "lib/frp-extra";
import { FrpEngine } from "lib/frp-engine";
import { FrpVehicle, VehicleUpdate } from "lib/frp-vehicle";
import * as rw from "lib/railworks";

enum Phase {
    III,
    IV,
    IVb,
    V,
}

enum BrakeLight {
    Green,
    Amber,
    Red,
    Unlit,
}

enum DoorCommand {
    /** Open the doors ASAP. */
    Open,
    /** Raise the trapdoor and play the alarm before closing the doors. */
    StartClose,
    /** Close the doors ASAP. */
    Close,
}
/** Time to raise the trapdoor and play the door alarm. */
const doorStartCloseS = 2;
/** Time to open/close the door. */
const doorOpenCloseS = 4;

const brakeMessageId = 10101;
const trapdoorMessageId = 10146;

const me = new FrpEngine(() => {
    // Brake pipe hoses and taillights
    const frontTaillights = [new rw.Light("TaiLight_1F"), new rw.Light("TaiLight_2F")];
    const rearTaillights = [new rw.Light("TaiLight_1R"), new rw.Light("TaiLight_2R")];
    const frontCoupled$ = frp.compose(
        me.createVehicleUpdateStream(),
        frp.map(vu => {
            const [f] = vu.couplings;
            return f;
        }),
        rejectRepeats()
    );
    const rearCoupled$ = frp.compose(
        me.createVehicleUpdateStream(),
        frp.map(vu => {
            const [, r] = vu.couplings;
            return r;
        }),
        rejectRepeats()
    );
    frontCoupled$(coupled => {
        me.rv.ActivateNode("hoses_pipe_F", coupled);
        me.rv.ActivateNode("uncoupled_hoses_F", !coupled);
        for (const light of frontTaillights) {
            light.Activate(!coupled);
        }
    });
    rearCoupled$(coupled => {
        me.rv.ActivateNode("hoses_pipe_R", coupled);
        me.rv.ActivateNode("uncoupled_hoses_R", !coupled);
        for (const light of rearTaillights) {
            light.Activate(!coupled);
        }
    });

    // Car livery, number, and flags
    let phase: Phase;
    const phaseCv = me.rv.GetControlMaximum("AmfleetPhase", 0) ?? 5;
    if (phaseCv > 4.7) {
        phase = Phase.V;
    } else if (phaseCv > 4.3) {
        phase = Phase.IVb;
    } else if (phaseCv > 3.5) {
        phase = Phase.IV;
    } else {
        phase = Phase.III;
    }

    // Decal selection
    const decals = new rw.RenderedEntity("NewDecals");
    const objects = new rw.RenderedEntity("NewObjects");
    const wifi = new rw.RenderedEntity("NewWiFi");
    const rvNumber$ = frp.compose(
        me.createUpdateStream(),
        frp.map(_ => me.rv.GetRVNumber()),
        rejectRepeats()
    );
    rvNumber$(fullNumber => {
        const carNumber = string.sub(fullNumber, 1, 5);
        const l = readRvFlag(fullNumber, "L");
        const w = readRvFlag(fullNumber, "W");
        const s = readRvFlag(fullNumber, "S");
        const t = readRvFlag(fullNumber, "T");

        decals.SetText(carNumber, rw.TextSet.Primary);

        if (phase === Phase.IV || phase === Phase.V) {
            // ADA accessibility stickers toggle
            decals.ActivateNode("wheelchair", s === 1);
        }
        if (phase === Phase.IV) {
            me.rv.SetText(carNumber, rw.TextSet.Primary);

            // Visibility of various Amtrak logos (e.g. Northeast Direct,
            // Amtrak, none)
            decals.ActivateNode("amtrak", l === 1);
            decals.ActivateNode("nedirect", l === 2);
        }
        if (phase === Phase.IVb) {
            // Cafe car "Regional" logo toggle
            decals.ActivateNode("regional", l === 1);
            // Bike car sticker toggle
            decals.ActivateNode("bike", s === 1 && w !== 0);
            // Displays the bike car decal in a different location if the WiFi
            // equipment is disabled but bike sticker is enabled
            decals.ActivateNode("bikealt", s === 1 && w === 0);

            // WiFi equipment toggle
            decals.ActivateNode("wifisticker", w === 1);
            for (const node of ["wifi", "wifibar", "wifibrackets", "wificables"]) {
                wifi.ActivateNode(node, w === 1);
            }
        }

        // Service type placards
        objects.ActivateNode("placard1", t === 1);
        objects.ActivateNode("placard2", t === 2);
        objects.ActivateNode("placard3", t === 3);
    });
    // Needs to execute every update, annoyingly
    const hideParentDecals$ = me.createUpdateStream();
    hideParentDecals$(_ => {
        me.rv.ActivateNode("ext_decals", false);
    });

    // Hide auto-generated number
    if (phase === Phase.IVb || phase === Phase.V) {
        const everyUpdate$ = me.createUpdateStream();
        everyUpdate$(_ => {
            me.rv.ActivateNode("primarydigits_5", false);
        });
    }

    // Brake status lights
    const brakeLightsGreen = [
        new rw.Light("LIGHTS_GREEN_1"),
        new rw.Light("LIGHTS_GREEN_2"),
        new rw.Light("LIGHTS_GREEN_3"),
        new rw.Light("LIGHTS_GREEN_4"),
    ];
    const brakeLightsAmber = [
        new rw.Light("LIGHTS_AMBER_1"),
        new rw.Light("LIGHTS_AMBER_2"),
        new rw.Light("LIGHTS_AMBER_3"),
        new rw.Light("LIGHTS_AMBER_4"),
    ];
    const brakeLightsRed = [
        new rw.Light("LIGHTS_RED_1"),
        new rw.Light("LIGHTS_RED_2"),
        new rw.Light("LIGHTS_RED_3"),
        new rw.Light("LIGHTS_RED_4"),
    ];
    const initBrakeLights$ = frp.compose(
        me.createUpdateStream(),
        once(),
        frp.map(_ => BrakeLight.Green)
    );
    const brakeLights$ = frp.compose(
        createBrakeLightStreamForWagon(me),
        frp.map(brakes => {
            if (brakes === true) {
                return BrakeLight.Amber;
            } else if (brakes === false) {
                return BrakeLight.Green;
            } else if (brakes < 95) {
                return BrakeLight.Red;
            } else if (brakes < 97) {
                return BrakeLight.Unlit;
            } else if (brakes < 100) {
                return BrakeLight.Amber;
            } else if (brakes < 102) {
                return BrakeLight.Unlit;
            } else {
                return BrakeLight.Green;
            }
        }),
        mergeBeforeStart(initBrakeLights$),
        rejectRepeats()
    );
    brakeLights$(bl => {
        objects.ActivateNode("brakes_green", bl === BrakeLight.Green);
        for (const light of brakeLightsGreen) {
            light.Activate(bl === BrakeLight.Green);
        }

        objects.ActivateNode("brakes_amber", bl === BrakeLight.Amber);
        for (const light of brakeLightsAmber) {
            light.Activate(bl === BrakeLight.Amber);
        }

        objects.ActivateNode("brakes_red", bl === BrakeLight.Red);
        for (const light of brakeLightsRed) {
            light.Activate(bl === BrakeLight.Red);
        }
    });

    // Door animations
    const areTrapdoorsDown = frp.stepper(
        frp.compose(
            me.createOnConsistMessageStream(),
            frp.filter(([id]) => id === trapdoorMessageId),
            frp.map(([, content]) => content.substring(0, 1) !== "0")
        ),
        true
    );
    const doorPositionLeft$ = createAnimateDoorStream(
        me,
        vu => {
            const [l] = vu.doorsOpen;
            return l;
        },
        areTrapdoorsDown
    );
    const doorPositionRight$ = createAnimateDoorStream(
        me,
        vu => {
            const [, r] = vu.doorsOpen;
            return r;
        },
        areTrapdoorsDown
    );
    const doorAnimateLeft$ = frp.compose(doorPositionLeft$, rejectRepeats());
    const doorAnimateRight$ = frp.compose(doorPositionRight$, rejectRepeats());
    doorAnimateLeft$(t => {
        me.rv.SetTime("lua_doors_l", t);
    });
    doorAnimateRight$(t => {
        me.rv.SetTime("lua_doors_r", t);
    });

    // Door status lights
    const doorLights = [
        new rw.Light("LIGHTS_DOORS_3"),
        new rw.Light("LIGHTS_DOORS_4"),
        new rw.Light("LIGHTS_DOORS_7"),
        new rw.Light("LIGHTS_DOORS_8"),
        new rw.Light("LIGHTS_DOORS_1"),
        new rw.Light("LIGHTS_DOORS_2"),
        new rw.Light("LIGHTS_DOORS_5"),
        new rw.Light("LIGHTS_DOORS_6"),
    ];
    const doorsOpen = frp.liftN(
        (leftPos, rightPos) => leftPos > 0 || rightPos > 0,
        frp.stepper(doorPositionLeft$, 0),
        frp.stepper(doorPositionRight$, 0)
    );
    const doorsOpen$ = frp.compose(me.createUpdateStream(), mapBehavior(doorsOpen), rejectRepeats());
    doorsOpen$(open => {
        objects.ActivateNode("doors_red", open);
        for (const light of doorLights) {
            light.Activate(open);
        }
    });

    // Forward our own consist messages
    const consistMessage$ = frp.compose(
        me.createOnConsistMessageStream(),
        frp.filter(([id]) => id === brakeMessageId || id === trapdoorMessageId)
    );
    consistMessage$(msg => {
        me.rv.SendConsistMessage(...msg);
    });

    me.e.BeginUpdate();
});
me.setup();

function readRvFlag(rvNumber: string, letter: string) {
    const [, , setting] = string.find(rvNumber, `;${letter}=(%d)`);
    return tonumber(setting) ?? 0;
}

function createAnimateDoorStream(
    me: FrpVehicle,
    areDoorsOpen: (update: VehicleUpdate) => boolean,
    areTrapdoorsDown: frp.Behavior<boolean>
) {
    type CommandAccum = DoorCommand.Open | [c: DoorCommand.StartClose, timerS: number] | DoorCommand.Close;

    const currentCommand = frp.stepper(
        frp.compose(
            me.createVehicleUpdateStream(),
            frp.fold((accum: CommandAccum, vu) => {
                const open = areDoorsOpen(vu);
                if (open) {
                    return DoorCommand.Open;
                } else if (accum === DoorCommand.Open) {
                    return [DoorCommand.StartClose, doorStartCloseS] as [DoorCommand.StartClose, number];
                } else if (accum === DoorCommand.Close) {
                    return DoorCommand.Close;
                } else {
                    const [, timerS] = accum;
                    return timerS <= vu.dt
                        ? DoorCommand.Close
                        : ([DoorCommand.StartClose, timerS - vu.dt] as [DoorCommand.StartClose, number]);
                }
            }, DoorCommand.Close)
        ),
        DoorCommand.Close
    );
    return frp.compose(
        me.createVehicleUpdateStream(),
        frp.fold((position, vu) => {
            const command = frp.snapshot(currentCommand);
            if (position < 1) {
                // door animation
                if (command === DoorCommand.Open) {
                    return Math.min(position + vu.dt / doorOpenCloseS, 1);
                } else if (command === DoorCommand.Close) {
                    return Math.max(position - vu.dt / doorOpenCloseS, 0);
                } else {
                    return position;
                }
            } else {
                // trapdoor animation
                if (command === DoorCommand.Open && frp.snapshot(areTrapdoorsDown)) {
                    return Math.min(position + vu.dt / doorStartCloseS, 2);
                } else if (command === DoorCommand.Close && position === 1) {
                    // transition to the door animation
                    return Math.max(position - vu.dt / doorOpenCloseS, 0);
                } else {
                    return Math.max(position - vu.dt / doorStartCloseS, 1);
                }
            }
        }, 0),
        frp.hub()
    );
}

function createBrakeLightStreamForWagon(me: FrpVehicle): frp.Stream<boolean | number> {
    const aiState$ = frp.compose(
        me.createAiUpdateStream(),
        frp.map(au => Math.abs(au.speedMps) < 4 * c.mph.toMps)
    );
    return frp.compose(
        me.createOnConsistMessageStream(),
        frp.filter(([id]) => id === brakeMessageId),
        frp.map(([, message]) => {
            const [, , psi] = string.find(message, "%.%d*10101(%d%d%d)$");
            if (psi !== undefined) {
                return tonumber(psi) as number;
            } else {
                const asNumber = tonumber(message);
                return asNumber !== undefined && asNumber >= 0.167;
            }
        }),
        frp.merge(aiState$)
    );
}
