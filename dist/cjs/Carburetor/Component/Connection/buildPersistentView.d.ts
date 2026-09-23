import { TReadonly } from "../../Models/Base.js";
import { IConnectionSource } from "../Models/Connection.js";
/**
 * Builds the persistent view one connect()-family declaration reads through: the once-only
 * shape probe, the declared-kind assertion, the forwarding facade.
 *
 * Serves both `connect` and `connectSelection`, which declare one connection, record through
 * one recorder, and hand out one facade whose object/array kind is fixed at declaration
 * time — the JS-03 contract, see `connect`'s docstring.
 */
export declare const buildPersistentView: <T extends object>(source: IConnectionSource<T>) => TReadonly<T>;
