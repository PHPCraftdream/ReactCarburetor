import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IPersistOptions} from "@/Carburetor/Models/Tooling";

/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 *
 * Persistence is synchronous by default: a write lands in storage before the call that caused
 * it returns, which the engine's own tests rely on. `options.coalesce` trades that for one
 * stringify per microtask instead of one per write (R16-09) — the latest state is still what
 * gets stored, and the disposer flushes a write still pending.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
    const {key, storage, coalesce} = options;
    const stored = storage.getItem(key);

    if (stored !== null) {
        try {
            carburetor.restore(JSON.parse(stored) as T);
        } catch (error: unknown) {
            storage.removeItem(key);

            if (options.onError) {
                options.onError(error);
            }
        }
    }

    // A failing write must reach onError like a failed restore does, and must not cut off the
    // subscribers notified after this one; the last good entry stays in place.
    const write = (): void => {
        try {
            // JSON.stringify never mutates and produces detached text, so a snapshot() clone
            // beforehand is pure overhead: stringify the live data directly.
            storage.setItem(key, JSON.stringify(carburetor.getData()));
        } catch (error: unknown) {
            if (options.onError) {
                options.onError(error);
            }
        }
    };

    // persist() needs "every write" — subscribe with no `reads` is the engine's own way to say
    // that, cheaper than a watch(select, onChange) whose selector would have to read (and diff)
    // the whole tree to notice anything.
    if (!coalesce) {
        const id = carburetor.subscribe(write);

        return () => carburetor.unsubscribe(id);
    }

    // One write per microtask: further changes before it runs just move the value it will
    // read, since write() always reads getData() fresh rather than a value captured at
    // schedule time.
    let pending = false;

    const flush = (): void => {
        if (!pending) {
            return;
        }

        pending = false;
        write();
    };

    const id = carburetor.subscribe(() => {
        if (pending) {
            return;
        }

        pending = true;
        queueMicrotask(flush);
    });

    return () => {
        carburetor.unsubscribe(id);
        flush();
    };
};
