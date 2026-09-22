import {TUpdater} from "@/Carburetor/Models/Base";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

/**
 * The default policy: an update is delivered right away and React does the batching.
 * No latency added to clicks or typing — unnecessary renders are never created,
 * so there is nothing to smooth out.
 */
export class SyncUpdateScheduler implements IUpdateScheduler {
    // noinspection JSUnusedLocalSymbols
    /**
     * Runs the update immediately; React batches what happens in one event.
     *
     * @param _uid - ignored: nothing is queued here, so there is no id to file an update under
     * @param updater - run on the call itself, before it returns; nothing defers it to a
     * later tick
     */
    public schedule = (_uid: string, updater: TUpdater) => {
        updater();
    };

    // noinspection JSUnusedLocalSymbols
    /** Nothing to cancel: an update was already delivered by the time this could be called. */
    public cancel = (_uid: string) => {
    };
}
