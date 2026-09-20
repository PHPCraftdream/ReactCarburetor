import {TDisposer} from "./Base";

/**
 * Identifies a carburetor inside a scope and knows how to build it.
 * A token is a module-level constant; the instances it produces are not.
 */
export interface ICarburetorToken<T> {
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
    /** Called when stored data cannot be read; by default the bad entry is dropped. */
    onError?: (error: unknown) => void;
}

export interface IHistoryOptions {
    /** How many past states to keep; older ones are dropped. */
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
