import { IDict, TDisposer } from "../Models/Base.mjs";
import { IInspectable } from "../Models/Store.mjs";
import { IDevToolsOptions } from "../Models/Tooling.mjs";
/**
 * Publishes the state of the given carburetors to the Redux DevTools extension and
 * applies time travel back onto them. Returns a disposer; if no extension is available
 * the call is a no-op.
 *
 * @param carburetors - keyed by name; each name becomes a top-level key of the published state
 * @param options - `extension` replaces the auto-discovered Redux extension, `name` titles the connection
 */
export declare const connectDevTools: (carburetors: IDict<IInspectable>, options?: IDevToolsOptions) => TDisposer;
