import { IUpdateScheduler, TUpdater } from "./Models.js";
/**
 * The default policy: an update is delivered right away and React does the batching.
 * No latency added to clicks or typing — unnecessary renders are never created,
 * so there is nothing to smooth out.
 */
export declare class SyncUpdateScheduler implements IUpdateScheduler {
    schedule: (_uid: string, updater: TUpdater) => void;
    cancel: (_uid: string) => void;
}
export declare const syncUpdateScheduler: SyncUpdateScheduler;
