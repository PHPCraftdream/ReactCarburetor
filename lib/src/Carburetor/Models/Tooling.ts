import {TDisposer} from "./Base";

/**
 * Identifies a carburetor inside a scope and knows how to build it.
 * A token is a module-level constant; the instances it produces are not.
 */
export interface ICarburetorToken<T> {
    /**
     * The token's name, written by the caller: the same string in every process, and the key
     * dehydrate() and hydrate() match on across the server/client boundary.
     */
    id: string;
    create: () => T;
}

/** The part of the Storage API persistence needs, so tests do not require a browser. */
export interface IStorageLike {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

export interface IPersistOptions {
    key: string;
    storage: IStorageLike;
    /**
     * Load/write errors reach this callback. Without it, getItem failures throw.
     *
     * Corrupt data and an unrestorable single entry are removed and reported (engine diagnostics
     * in development, silent in production). With several `partitions` a failed restore keeps
     * every stored entry, since the guilty one is unknown. With `version`, an entry that fails to
     * migrate or comes from a newer version is kept, and this subscription stops writing.
     */
    onError?: (error: unknown) => void;
    /**
     * On by default: batches same-microtask writes into one stringify instead of one per write.
     * Stringifying on every write costs 6.1–218 ms for 50 one-field updates at 10k rows (R33-07).
     * False: one write per notification, with no extra microtask. With the default immediate
     * delivery it lands before the call that caused it returns; a deferring scheduler
     * (ComponentUpdateThrottle) or a transaction delays the notification, and the write with it.
     * The disposer always flushes a write still pending (coalesce true or false).
     */
    coalesce?: boolean;
    /**
     * Minimum time in milliseconds between two storage writes. The first write still happens
     * right away; later flushes wait until the window since the previous write has passed, and
     * the disposer writes a state still held back. Requires the default coalescing; a negative
     * or non-finite value throws.
     */
    throttleMs?: number;
    /**
     * Opt-in partitioned storage: one key per named top-level branch of the wire form
     * (`key + "." + branch`), each rewritten only when that branch changed, so a flush pays
     * for the dirty partitions instead of the whole state. The first write seals every
     * partition once. Restore composes the stored branches over the current state: branches
     * without a stored entry keep their value, and a legacy whole-store entry is read when no
     * partition entries exist yet. A restore the store rejects removes the stored entry only
     * when the culprit is known — a single key, or the one stored partition; with several
     * stored partitions the entries are kept and the failure is only reported. A malformed
     * entry that cannot be parsed is still removed on its own. Branch names must be plain
     * top-level keys of the wire form; anything else throws.
     */
    partitions?: ReadonlyArray<string>;
    /** Current non-negative schema version; versioned entries use `{v, data}` envelopes. */
    version?: number;
    /** Synchronous migrations; each key `n` converts version `n - 1` into `n`. */
    migrate?: Record<number, (state: unknown) => unknown>;
    /** Prunes closed schemas, or controls merging for custom dictionaries. */
    prune?: boolean | ((saved: unknown, current: unknown) => unknown);
}

export interface IHistoryOptions {
    /** Maximum past states to retain. A positive safe integer; defaults to 50. Invalid values throw. */
    limit?: number;
}

/** The slice of the Redux DevTools protocol this integration needs. */
export interface IDevToolsMessage {
    type: string;
    payload?: {
        type?: string;
        actionId?: number;
    };
    state?: string;
}

export interface IDevToolsConnection {
    init: (state: unknown) => void;
    send: (action: string, state: unknown) => void;
    subscribe: (listener: (message: IDevToolsMessage) => void) => TDisposer | void;
}

export interface IDevToolsExtension {
    connect: (options: {name?: string}) => IDevToolsConnection;
}

export interface IDevToolsOptions {
    name?: string;
    /** Injectable for tests and for environments without the browser extension. */
    extension?: IDevToolsExtension;
}
