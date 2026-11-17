import {TDisposer} from "../Models/Base";
import {IComputed} from "../Models/Derived";

/**
 * Calls `onChange(next, previous)` after each change the computed delivers, until the disposer runs.
 *
 * Every notification of a computed is a change: it wakes subscribers only when its settled value
 * differs from the last one it announced, judged by its own `equals`. A result changed in place
 * arrives as the same object in both arguments. A body that throws is rethrown by `get()` inside
 * the subscriber, so it is reported like any subscriber failure and `onChange` does not run. A body
 * that throws on the first read throws out of `watch` itself, which keeps no subscription.
 *
 * @param computed - the derived value to watch
 * @param onChange - receives the new value and the value the previous change delivered
 */
export const watchComputed = <R>(
    computed: IComputed<R>,
    onChange: (next: R, previous: R) => void
): TDisposer => {
    let ready = false;
    let stopped = false;
    let previous = undefined as R;
    const id = computed.subscribe(() => {
        if (!ready || stopped) return;
        const next = computed.get();
        const before = previous;
        previous = next;
        onChange(next, before);
    });

    // The subscription exists before the first read, so a body that throws here must take it
    // back: no disposer reaches the caller to do it.
    try {
        previous = computed.get();
    } catch (error: unknown) {
        stopped = true;
        computed.unsubscribe(id);
        throw error;
    }
    ready = true;

    return (): void => {
        if (stopped) return;
        stopped = true;
        computed.unsubscribe(id);
    };
};
