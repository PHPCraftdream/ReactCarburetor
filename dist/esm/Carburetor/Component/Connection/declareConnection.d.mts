import { ICarburetor } from "../../Models/Store.mjs";
import { IConnection, IConnectionSource, IRenderAttempt } from "../Models/Connection.mjs";
/**
 * Declares one connect()-family connection into its owner's persistent list and builds the
 * closures its view is read through, so both declarations share one piece of machinery.
 *
 * The declaration only ever pushes a connection and closes over it: React can construct an
 * instance and later decide never to commit it, so any subscription taken here would leak one
 * for a component that never mounted. Everything the recorder captures stays tentative until
 * the commit that consumes the attempt.
 *
 * @param connections - the owner's persistent declaration list, appended to and never pruned
 * @param attemptKeyPrefix - the attempt-map key prefix marking entries that publish to a connection
 * @param getAttempt - reads the render attempt currently open on the owner, if any
 * @param source - the carburetor to read, or a function resolving it at each attempt's first read
 */
export declare const declareConnection: <T extends object>(connections: IConnection[], attemptKeyPrefix: string, getAttempt: () => IRenderAttempt | undefined, source: ICarburetor<T> | (() => ICarburetor<T>)) => IConnectionSource<T>;
