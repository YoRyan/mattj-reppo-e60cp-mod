import * as frp from "./frp";
import * as rw from "./railworks";

type PrimitiveTypes = number | boolean | string | undefined | null;

/**
 * Continously display the value of an event stream to aid in FRP debugging.
 */
export function debug(eventStream: frp.Stream<any>) {
    const frequency = 0.5;
    frp.throttle(frequency * 1000)(eventStream)(value => {
        rw.ScenarioManager.ShowInfoMessageExt(
            "Event Stream",
            `${value}`,
            frequency,
            rw.MessageBoxPosition.Centre,
            rw.MessageBoxSize.Small,
            false
        );
    });
}

/**
 * Creates a state machine that records the last and current values of the event
 * stream.
 * @param initState The initial value of the state machine.
 */
export function fsm<T>(initState: T): (eventStream: frp.Stream<T>) => frp.Stream<[from: T, to: T]> {
    return frp.fold<[T, T], T>((accum, value) => [accum[1], value], [initState, initState]);
}

/**
 * Filters out successive values in an event stream.
 */
export function rejectRepeats<T extends PrimitiveTypes>(): (eventStream: frp.Stream<T>) => frp.Stream<T> {
    return eventStream => next => {
        let started = false;
        let last: T | undefined = undefined;
        eventStream(value => {
            if (!started || last !== value) {
                started = true;
                last = value;
                next(value);
            }
        });
    };
}

/**
 * Filters out undefined values from an event stream.
 */
export function rejectUndefined<T>(): (eventStream: frp.Stream<T | undefined>) => frp.Stream<T> {
    return frp.reject<T | undefined>(value => value === undefined) as (
        eventStream: frp.Stream<T | undefined>
    ) => frp.Stream<T>;
}

/**
 * Discards an event stream once it has emitted one event.
 */
export function once<T>(): (eventStream: frp.Stream<T>) => frp.Stream<T> {
    enum State {
        Wait,
        Emit,
        Discard,
    }
    type Accum = State.Wait | [state: State.Emit, event: T] | State.Discard;
    return eventStream =>
        frp.compose(
            eventStream,
            frp.fold<Accum, T>((accum, evt) => (accum === State.Wait ? [State.Emit, evt] : State.Discard), State.Wait),
            frp.filter(accum => accum !== State.Wait && accum !== State.Discard),
            frp.map(accum => {
                const [, evt] = accum as [State.Emit, T];
                return evt;
            })
        );
}

/**
 * Merges event stream A into event stream B only if B has not yet produced any
 * events.
 */
export function mergeBeforeStart<A, B>(
    eventStreamA: frp.Stream<A>
): (eventStreamB: frp.Stream<B>) => frp.Stream<A | B> {
    return eventStreamB => {
        return next => {
            let started = false;
            eventStreamA(value => {
                if (!started) {
                    next(value);
                }
            });
            eventStreamB(value => {
                started = true;
                next(value);
            });
        };
    };
}

/**
 * Maps a behavior onto all events of a stream.
 */
export function mapBehavior<T>(behavior: frp.Behavior<T>): (eventStream: frp.Stream<any>) => frp.Stream<T> {
    return frp.map(_ => frp.snapshot(behavior));
}
