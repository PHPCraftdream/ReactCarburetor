import { ICarburetor } from "../../Models/Store.mjs";
import { IConnection, IConnectionSource, IRenderAttempt } from "../Models/Connection.mjs";
/**
 * Declares one connect()-family connection into its owner's persistent list and builds the one
 * state object both its view and its recorder are read through.
 *
 * @param connections - the owner's persistent declaration list, appended to and never pruned
 * @param getAttempt - reads the render attempt currently open on the owner, if any
 * @param source - the carburetor to read, or a function resolving it at each attempt's first read
 */
export declare const declareConnection: <T extends object>(connections: IConnection[], getAttempt: () => IRenderAttempt | undefined, source: ICarburetor<T> | (() => ICarburetor<T>)) => IConnectionSource<T>;
