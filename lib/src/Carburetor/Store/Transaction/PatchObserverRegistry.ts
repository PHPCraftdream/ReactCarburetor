import {TDisposer} from '@/Carburetor/Models/Base';
import {IPatchObserver, IWritePatch, PATCH_OPAQUE, TPatchPort, TPatchRecorder} from '@/Carburetor/Models/Paths';
import {IUpdateScheduler} from '@/Carburetor/Models/Store';
import {getUid} from '@/Carburetor/Store/Utils/getUid';

/** One attachment's identity and delivery guard. */
interface IRegistration {
    /** Stable observer protocol for this attachment. */
    observer: IPatchObserver;
    /** Cancellation key for deferred publication, when requested. */
    schedulerKey: string | undefined;
    /** Attachment epoch excludes observers added during dispatch. */
    generation: number;
}

/** One store's patch observers. Created only when the first observer attaches. */
export class PatchObserverRegistry {
    /** Active attachments keyed by observer identity. */
    private readonly registrations = new Map<IPatchObserver, IRegistration>();
    /** Monotonic attachment epoch. */
    private generation = 0;
    /** Direct dispatch when only one observer remains. */
    private single: IRegistration | undefined;
    /** Replaceable patch-only attachment, independent of histories. */
    private patchOnly: IRegistration | undefined;

    /** Created only if a second observer attaches; the usual one-observer path stays direct. */
    private fanout: TPatchRecorder | undefined;

    /** Delivers one mutation to the active attachment set. */
    private reportPatch(patch: IWritePatch | typeof PATCH_OPAQUE): void {
        const generation = this.generation;
        let failed = false;
        let firstError: unknown;
        for (const registration of this.registrations.values()) {
            const observer = registration.observer;
            if (registration.generation > generation || this.registrations.get(observer) !== registration) {
                continue;
            }
            try {
                observer.patch(patch);
            } catch (error: unknown) {
                if (!failed) {
                    firstError = error;
                    failed = true;
                }
            }
        }
        if (failed) {
            throw firstError;
        }
    }

    /**
     * Binds the lazy registry to its store.
     *
     * @param port - mutation dispatcher shared with draft proxies
     * @param scheduler - publication delivery and cancellation
     */
    constructor(private readonly port: TPatchPort, private readonly scheduler: IUpdateScheduler) {}

    /** Registers an independent history, or replaces only the previous patch-only observer. */
    public attach(observer: IPatchObserver): TDisposer {
        if (!observer.publication && !observer.ownRestore && this.patchOnly) {
            this.detach(this.patchOnly);
        }
        const previous = this.registrations.get(observer);
        if (previous) {
            this.detach(previous);
        }
        const registration: IRegistration = {
            observer, schedulerKey: observer.publication ? getUid() : undefined,
            generation: ++this.generation,
        };
        this.registrations.set(observer, registration);
        if (!observer.publication && !observer.ownRestore) {
            this.patchOnly = registration;
        }
        this.single = this.registrations.size === 1 ? registration : undefined;
        if (!this.single) {
            this.fanout ??= (patch: IWritePatch | typeof PATCH_OPAQUE): void => this.reportPatch(patch);
        }
        this.port.listener = this.single?.observer.patch ?? this.fanout;
        return () => this.detach(registration);
    }

    /** Detaches only this attachment, including any deferred scheduler delivery. */
    private detach(registration: IRegistration): void {
        if (this.registrations.get(registration.observer) !== registration) {
            return;
        }
        if (registration.schedulerKey !== undefined) {
            this.scheduler.cancel(registration.schedulerKey);
        }
        this.registrations.delete(registration.observer);
        if (this.patchOnly === registration) {
            this.patchOnly = undefined;
        }
        this.single = this.registrations.size === 1
            ? this.registrations.values().next().value
            : undefined;
        this.port.listener = this.registrations.size === 0
            ? undefined
            : this.single?.observer.patch ?? this.fanout;
    }

    /** Reports the exact restore argument to all attached histories before its own installation. */
    public ownRestore(state: unknown): void {
        const sole = this.single;
        if (sole) {
            sole.observer.ownRestore?.(state);
            return;
        }
        if (this.registrations.size === 0) {
            return;
        }
        const generation = this.generation;
        for (const registration of this.registrations.values()) {
            const observer = registration.observer;
            if (registration.generation <= generation && this.registrations.get(observer) === registration) {
                observer.ownRestore?.(state);
            }
        }
    }

    /** Queues history before ordinary subscribers; failures do not starve another history. */
    public publish(): unknown[] | undefined {
        const sole = this.single;
        if (sole) {
            if (sole.observer.publication && sole.schedulerKey !== undefined) {
                try {
                    this.scheduler.schedule(sole.schedulerKey, sole.observer.publication);
                } catch (error: unknown) {
                    return [error];
                }
            }
            return undefined;
        }
        if (this.registrations.size === 0) {
            return undefined;
        }
        const generation = this.generation;
        let failures: unknown[] | undefined;
        for (const registration of this.registrations.values()) {
            const observer = registration.observer;
            if (registration.generation > generation || this.registrations.get(observer) !== registration) {
                continue;
            }
            if (observer.publication && registration.schedulerKey !== undefined) {
                try {
                    this.scheduler.schedule(registration.schedulerKey, observer.publication);
                } catch (error: unknown) {
                    (failures ??= []).push(error);
                }
            }
        }
        return failures;
    }
}
