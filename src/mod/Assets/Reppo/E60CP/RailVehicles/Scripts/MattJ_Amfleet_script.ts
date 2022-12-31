/** @noSelfInFile */

import * as frp from "lib/frp";
import { once, rejectRepeats } from "lib/frp-extra";
import { FrpEngine } from "lib/frp-engine";
import * as rw from "lib/railworks";

require("Assets/Reppo/E60CP/RailVehicles/Scripts/Amfleet_script.out");

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

const me = new FrpEngine(() => {
    // car livery, number, and flags
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

    // decal selection
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
            // visibility of various Amtrak logos (e.g. Northeast Direct, Amtrak, none)
            decals.ActivateNode("amtrak", l === 1);
            decals.ActivateNode("nedirect", l === 2);
        }
        if (phase === Phase.IVb) {
            // cafe car "Regional" logo toggle
            decals.ActivateNode("regional", l === 1);
            // bike car sticker toggle
            decals.ActivateNode("bike", s === 1 && w !== 0);
            // displays the bike car decal in a different location if the WiFi equipment is disabled but bike sticker is enabled
            decals.ActivateNode("bikealt", s === 1 && w === 0);

            // WiFi equipment toggle
            decals.ActivateNode("wifisticker", w === 1);
            for (const node of ["wifi", "wifibar", "wifibrackets", "wificables"]) {
                wifi.ActivateNode(node, w === 1);
            }
        }

        // service type placards
        objects.ActivateNode("placard1", t === 1);
        objects.ActivateNode("placard2", t === 2);
        objects.ActivateNode("placard3", t === 3);
    });
    const atLoad$ = me.createUpdateStream(); // frp.compose(me.createUpdateStream(), once());
    atLoad$(_ => {
        me.rv.ActivateNode("ext_decals", false);
    });

    // hide auto-generated number
    if (phase === Phase.IVb || phase === Phase.V) {
        const everyUpdate$ = me.createUpdateStream();
        everyUpdate$(_ => {
            me.rv.ActivateNode("primarydigits_5", false);
        });
    }

    // brake status lights
    const brakeLights$ = frp.compose(
        me.createUpdateStream(),
        frp.map(_ => {
            const pipePsi = me.rv.GetControlValue("AirBrakePipePressurePSI", 0) as number;
            if (pipePsi < 95) {
                return BrakeLight.Red;
            } else if (pipePsi < 97) {
                return BrakeLight.Unlit;
            } else if (pipePsi < 100) {
                return BrakeLight.Amber;
            } else if (pipePsi < 102) {
                return BrakeLight.Unlit;
            } else {
                return BrakeLight.Green;
            }
        }),
        rejectRepeats()
    );
    brakeLights$(bl => {
        me.rv.ActivateNode("brakes_green", bl === BrakeLight.Green);
        me.rv.ActivateNode("brakes_amber", bl === BrakeLight.Amber);
        me.rv.ActivateNode("brakes_red", bl === BrakeLight.Red);
    });

    // door status lights
    const doorLightsAi$ = frp.compose(
        me.createAiUpdateStream(),
        frp.map(au => au.isStopped)
    );
    const doorLightLeft$ = frp.compose(
        me.createPlayerUpdateStream(),
        frp.map(pu => {
            const [open] = pu.doorsOpen;
            return open;
        }),
        frp.merge(doorLightsAi$),
        rejectRepeats()
    );
    const doorLightRight$ = frp.compose(
        me.createPlayerUpdateStream(),
        frp.map(pu => {
            const [, open] = pu.doorsOpen;
            return open;
        }),
        frp.merge(doorLightsAi$),
        rejectRepeats()
    );
    doorLightLeft$(on => {
        me.rv.ActivateNode("doors_left", on);
    });
    doorLightRight$(on => {
        me.rv.ActivateNode("doors_right", on);
    });
});
me.setup();

function readRvFlag(rvNumber: string, letter: string) {
    const [, , setting] = string.find(rvNumber, `;${letter}=(%d)`);
    return tonumber(setting) ?? 0;
}
