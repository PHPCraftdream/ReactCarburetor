import { TReadonly } from "../../Models/Base.js";
import { IConnectionSource } from "../Models/Connection.js";
/**
 * Builds the persistent view one connect()-family declaration reads through: the once-only
 * shape probe, then a facade whose traps (`ConnectionFacadeHandler`) forward every access to
 * the resolved view.
 *
 * Serves both `connect` and `connectSelection`, which declare one connection, record through
 * one recorder, and hand out one facade whose object/array kind is fixed at declaration
 * time — the JS-03 contract, see `connect`'s docstring.
 *
 * @param source - the declaration's state, built by declareConnection; this call fixes its
 * `arrayFacade`/`probeError` fields and hands the same object to the facade's trap handler
 */
export declare const buildPersistentView: <T extends object>(source: IConnectionSource<T>) => TReadonly<T>;
