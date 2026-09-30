import { TDisposer } from '../../Models/Base.js';
import { IPatchObserver, TPatchPort } from '../../Models/Paths.js';
import { IUpdateScheduler } from '../../Models/Store.js';
/** One store's patch observers. Created only when the first observer attaches. */
export declare class PatchObserverRegistry {
    private readonly port;
    private readonly scheduler;
    /** Active attachments keyed by observer identity. */
    private readonly registrations;
    /** Monotonic attachment epoch. */
    private generation;
    /** Direct dispatch when only one observer remains. */
    private single;
    /** Replaceable patch-only attachment, independent of histories. */
    private patchOnly;
    /** Created only if a second observer attaches; the usual one-observer path stays direct. */
    private fanout;
    /** Delivers one mutation to the active attachment set. */
    private reportPatch;
    /**
     * Binds the lazy registry to its store.
     *
     * @param port - mutation dispatcher shared with draft proxies
     * @param scheduler - publication delivery and cancellation
     */
    constructor(port: TPatchPort, scheduler: IUpdateScheduler);
    /** Registers an independent history, or replaces only the previous patch-only observer. */
    attach(observer: IPatchObserver): TDisposer;
    /** Detaches only this attachment, including any deferred scheduler delivery. */
    private detach;
    /** Reports the exact restore argument to all attached histories before its own installation. */
    ownRestore(state: unknown): void;
    /** Queues history before ordinary subscribers; failures do not starve another history. */
    publish(): unknown[] | undefined;
}
