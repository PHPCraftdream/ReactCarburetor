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
    /** Load/write errors reach this callback. Without it, getItem failures throw;
     * corrupt stored data is removed by default.
     */
    onError?: (error: unknown) => void;
    /**
     * On by default: batches same-microtask writes into one stringify instead of one per write.
     * Stringifying on every write costs 6.1–218 ms for 50 one-field updates at 10k rows (R33-07).
     * False: synchronous, one write lands in storage before the call that caused it returns.
     * The disposer always flushes a write still pending (coalesce true or false).
     */
    coalesce?: boolean;
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
