/** @noSelfInFile */

import * as frp from "./frp";
import { FrpSource } from "./frp-entity";
import { rejectUndefined } from "./frp-extra";
import { FrpVehicle, PlayerUpdate, VehicleCamera } from "./frp-vehicle";
import * as rw from "./railworks";

/**
 * Represents the in-game "location" of the player.
 */
export enum PlayerLocation {
    /**
     * The player is not inside this engine.
     */
    Away,
    /**
     * The player is seated in the front cab.
     */
    InFrontCab,
    /**
     * The player is seated in the rear cab.
     */
    InRearCab,
}

export class FrpEngine extends FrpVehicle {
    /**
     * Convenient acces to the methods for an engine.
     */
    public readonly eng = new rw.Engine("");

    private readonly playerWithKeyUpdateSource = new FrpSource<PlayerUpdate>();
    private readonly playerWithoutKeyUpdateSource = new FrpSource<PlayerUpdate>();
    private readonly signalMessageSource = new FrpSource<string>();

    constructor(onInit: () => void) {
        super(onInit);

        const playerUpdate$ = this.createPlayerUpdateStream();
        playerUpdate$(pu => {
            if (this.eng.GetIsEngineWithKey()) {
                this.playerWithKeyUpdateSource.call(pu);
            } else {
                this.playerWithoutKeyUpdateSource.call(pu);
            }
        });
    }

    /**
     * Create an event stream that fires while the current rail vehicle is the
     * player-controlled engine.
     * @returns The new stream, which contains some useful vehicle state.
     */
    createPlayerWithKeyUpdateStream() {
        return this.playerWithKeyUpdateSource.createStream();
    }

    /**
     * Create an event stream that fires while the current rail vehicle is a
     * helper in the player train.
     * @returns The new stream, which contains some useful vehicle state.
     */
    createPlayerWithoutKeyUpdateStream() {
        return this.playerWithoutKeyUpdateSource.createStream();
    }

    /**
     * Create an event stream from the OnCustomSignalMessage() callback, which
     * fires when the player-controlled engine receives a custom message from
     * a lineside signal.
     * @returns The new stream of signal messages.
     */
    createOnSignalMessageStream() {
        return this.signalMessageSource.createStream();
    }

    /**
     * Create a behavior for the player's current "location" relative to the
     * engine.
     */
    createPlayerLocationBehavior() {
        const isAway$ = frp.compose(
            this.createAiUpdateStream(),
            frp.merge(this.createPlayerWithoutKeyUpdateStream()),
            frp.map(_ => PlayerLocation.Away)
        );
        const location$ = frp.compose(
            this.createOnCameraStream(),
            frp.map(vc => {
                switch (vc) {
                    case VehicleCamera.FrontCab:
                        return PlayerLocation.InFrontCab;
                    case VehicleCamera.RearCab:
                        return PlayerLocation.InRearCab;
                    default:
                        return undefined;
                }
            }),
            rejectUndefined(),
            frp.merge(isAway$)
        );
        return frp.stepper(location$, PlayerLocation.InFrontCab);
    }

    setup() {
        super.setup();

        OnCustomSignalMessage = this.chain(OnCustomSignalMessage, msg => {
            this.signalMessageSource.call(msg);
        });
    }
}
