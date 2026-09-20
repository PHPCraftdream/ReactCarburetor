import { IDict, TDisposer } from "../Models/Base.js";
import { IInspectable } from "../Models/Store.js";
import { IDevToolsOptions } from "../Models/Tooling.js";
/**
 * Publishes the state of the given carburetors to the Redux DevTools extension and
 * applies time travel back onto them. Returns a disposer; if no extension is available
 * the call is a no-op.
 */
export declare const connectDevTools: (carburetors: IDict<IInspectable>, options?: IDevToolsOptions) => TDisposer;
