import {TDisposer, TEffectCleanup, TReadonly, TStoreEffect} from "../Models/Base";
import {IComputed} from "../Models/Derived";
import {ICarburetor, TSelector} from "../Models/Store";
import {IStoreEffect} from "../Models/Tooling";
import {watchComputed} from "../Derived/watchComputed";

/**
 * Runs a store effect now and after every change, each run after the previous run's cleanup.
 *
 * The subscription is made before the first run, so a change the effect itself causes is seen; a
 * first run that throws stops it again before the error leaves, since no disposer reaches the
 * caller. The returned cleanup stops the subscription and then runs the last run's cleanup.
 *
 * @param subscribe - starts watching; its callback gets the new and the previous value
 * @param current - the value right now, read once the subscription exists
 * @param effect - the store effect to run
 */
const follow = <V>(
    subscribe: (onChange: (next: V, previous: V) => void) => TDisposer,
    current: () => V,
    effect: TStoreEffect<V>
): TDisposer => {
    let cleanup: TEffectCleanup | undefined;
    // A cleanup that throws does not cost the new value its run: the effect still runs, and the
    // first error is rethrown once both are done, so it is reported like any subscriber failure.
    const run = (value: V, previous: V | undefined): void => {
        const prior = cleanup;
        cleanup = undefined;
        let failure: {error: unknown} | undefined;
        try {
            prior?.();
        } catch (error: unknown) {
            failure = {error};
        }
        try {
            const result = effect(value, previous);
            cleanup = typeof result === 'function' ? result : undefined;
        } catch (error: unknown) {
            failure ??= {error};
        }
        if (failure !== undefined) throw failure.error;
    };
    const stop = subscribe(run);

    try {
        run(current(), undefined);
    } catch (error: unknown) {
        stop();
        throw error;
    }

    return (): void => {
        stop();
        const prior = cleanup;
        cleanup = undefined;
        prior?.();
    };
};

/**
 * An effect that follows store data, outside a component: `useStoreEffect` without React.
 *
 * The effect runs at once with the current value, then after every change with the new value and
 * the previous one; a run's returned cleanup runs before the next run, and a cleanup that throws
 * still lets that run happen (the cleanup's error is reported afterwards). The returned disposer stops
 * following and runs the last cleanup. Unlike `watch`, which calls back only on a change, it also
 * runs for the value as it is now.
 *
 * @param source - the store, or the computed
 * @param selectOrEffect - the selector for a store, the effect for a computed
 * @param effect - the effect for a store; absent for a computed
 */
export const storeEffect: IStoreEffect = (
    source: Pick<ICarburetor<unknown>, 'getData' | 'watch'> | IComputed<unknown>,
    selectOrEffect: TSelector<unknown, unknown> | TStoreEffect<unknown>,
    effect?: TStoreEffect<unknown>
): TDisposer => {
    if (effect === undefined) {
        const computed = source as IComputed<unknown>;

        return follow(
            (onChange) => watchComputed(computed, onChange),
            () => computed.get(),
            selectOrEffect as TStoreEffect<unknown>
        );
    }

    const store = source as Pick<ICarburetor<unknown>, 'getData' | 'watch'>;
    const select = selectOrEffect as TSelector<unknown, unknown>;

    return follow(
        (onChange) => store.watch(select, onChange),
        () => select(store.getData() as TReadonly<unknown>) as TReadonly<unknown>,
        effect as TStoreEffect<TReadonly<unknown>>
    );
};
