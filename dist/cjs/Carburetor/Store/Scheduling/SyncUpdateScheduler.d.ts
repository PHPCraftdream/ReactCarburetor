import { TUpdater } from "../../Models/Base.js";
import { IUpdateScheduler } from "../../Models/Store.js";
/**
 * The default policy: an update is delivered right away and React does the batching.
 * No latency added to clicks or typing — unnecessary renders are never created,
 * so there is nothing to smooth out.
 */
export declare class SyncUpdateScheduler implements IUpdateScheduler {
    /**
     * Runs the update immediately; React batches what happens in one event.
     *
     * A method, not an arrow field: a subclass override lands on the prototype instead of an
     * own property shadowing it.
     *
     * @param _uid - ignored: nothing is queued here, so there is no id to file an update under
     * @param updater - run on the call itself, before it returns; nothing defers it to a
     * later tick
     */
    schedule(_uid: string, updater: TUpdater): void;
    /** Nothing to cancel: an update was already delivered by the time this could be called. */
    cancel(_uid: string): void;
}
