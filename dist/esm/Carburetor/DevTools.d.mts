import { IDict, IInspectable, TDisposer } from "./Models.mjs";
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
    connect: (options: {
        name?: string;
    }) => IDevToolsConnection;
}
export interface IDevToolsOptions {
    name?: string;
    /** Injectable for tests and for environments without the browser extension. */
    extension?: IDevToolsExtension;
}
/**
 * Publishes the state of the given carburetors to the Redux DevTools extension and
 * applies time travel back onto them. Returns a disposer; if no extension is available
 * the call is a no-op.
 */
export declare const connectDevTools: (carburetors: IDict<IInspectable>, options?: IDevToolsOptions) => TDisposer;
