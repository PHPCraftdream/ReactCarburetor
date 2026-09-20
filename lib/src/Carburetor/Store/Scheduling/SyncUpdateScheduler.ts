import {TUpdater} from "../../Models/Base";
import {IUpdateScheduler} from "../../Models/Store";

/**
 * The default policy: an update is delivered right away and React does the batching.
 * No latency added to clicks or typing — unnecessary renders are never created,
 * so there is nothing to smooth out.
 */
export class SyncUpdateScheduler implements IUpdateScheduler {
    // noinspection JSUnusedLocalSymbols
    public schedule = (_uid: string, updater: TUpdater) => {
        updater();
    };

    // noinspection JSUnusedLocalSymbols
    public cancel = (_uid: string) => {
    };
}
