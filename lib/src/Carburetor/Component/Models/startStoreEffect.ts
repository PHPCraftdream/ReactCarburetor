import {TDisposer, TEffectCleanup, TStoreEffect} from "../../Models/Base";

/**
 * Runs a store effect now and after every change, each run after the previous run's cleanup.
 *
 * The subscription is made before the first run, so a change the effect itself causes is seen. The
 * returned cleanup stops the subscription and then runs the last run's cleanup: what a component's
 * effect hands back to be called before it re-runs and on unmount.
 *
 * @param subscribe - starts watching; its callback gets the new and the previous value
 * @param current - the value right now, read once the subscription exists
 * @param effect - the store effect to run
 */
export const startStoreEffect = <V>(
    subscribe: (onChange: (next: V, previous: V) => void) => TDisposer,
    current: () => V,
    effect: TStoreEffect<V>
): TEffectCleanup => {
    let cleanup: TEffectCleanup | undefined;
    const run = (value: V, previous: V | undefined): void => {
        const prior = cleanup;
        cleanup = undefined;
        prior?.();
        const result = effect(value, previous);
        cleanup = typeof result === 'function' ? result : undefined;
    };
    const stop = subscribe(run);

    run(current(), undefined);

    return (): void => {
        stop();
        const prior = cleanup;
        cleanup = undefined;
        prior?.();
    };
};
