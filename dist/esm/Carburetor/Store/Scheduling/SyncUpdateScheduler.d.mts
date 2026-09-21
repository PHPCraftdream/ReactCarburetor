import { TUpdater } from "../../Models/Base.mjs";
import { IUpdateScheduler } from "../../Models/Store.mjs";
/**
 * The default policy: an update is delivered right away and React does the batching.
 * No latency added to clicks or typing — unnecessary renders are never created,
 * so there is nothing to smooth out.
 */
export declare class SyncUpdateScheduler implements IUpdateScheduler {
    /** Runs the update immediately; React batches what happens in one event. */
    schedule: (_uid: string, updater: TUpdater) => void;
    /** Nothing to cancel: an update was already delivered by the time this could be called. */
    cancel: (_uid: string) => void;
}
