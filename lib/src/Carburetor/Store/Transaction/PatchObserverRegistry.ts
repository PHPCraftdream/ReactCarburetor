import {TDisposer} from '@/Carburetor/Models/Base';
import {
    IStatePublication, IStateRestoreClaim, IPatchObserver,
    STATE_MIXED_PUBLICATION, STATE_MUTATION_PUBLICATION, TPatchPort, TPatchRecorder,
} from '@/Carburetor/Models/Paths';
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
    /** Stable scheduled callback; facts travel in the record rather than per-event wrappers. */
    deliverPublication: (() => void) | undefined;
    /** Whether one publication callback is waiting in the scheduler. */
    publicationPending: boolean;
    /** Exact fact when a single installation owns the scheduled publication. */
    publicationFact: IStatePublication | undefined;
    /** Several coalesced operations cannot inherit one installation's owner token. */
    publicationAmbiguous: boolean;
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
    /** One exact custom restore claim waiting for its matching setData installation. */
    private pendingRestoreClaim: {state: unknown; claim: IStateRestoreClaim} | undefined;

    /** Created only if a second observer attaches; the usual one-observer path stays direct. */
    private fanout: TPatchRecorder | undefined;

    /** Single-observer fast path: clears the restore claim exactly like the fan-out path. */
    private readonly directPatch = (patch: Parameters<TPatchRecorder>[0]): void => {
        this.pendingRestoreClaim = undefined;
        const observer = this.single?.observer;
        if (observer) observer.patch(patch);
    };

    /** Delivers one mutation to the active attachment set. */
    private reportPatch(patch: Parameters<TPatchRecorder>[0]): void {
        this.pendingRestoreClaim = undefined;
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
        this.pendingRestoreClaim = undefined;
        if (!observer.publication && !observer.ownRestore && !observer.restoreClaim && this.patchOnly) {
            this.detach(this.patchOnly);
        }
        const previous = this.registrations.get(observer);
        if (previous) {
            this.detach(previous);
        }
        const registration: IRegistration = {
            observer, schedulerKey: observer.publication ? getUid() : undefined,
            generation: ++this.generation,
            deliverPublication: undefined, publicationPending: false,
            publicationFact: undefined, publicationAmbiguous: false,
        };
        if (observer.publication) {
            registration.deliverPublication = (): void => {
                if (!registration.publicationPending
                    || this.registrations.get(observer) !== registration) return;
                const fact = registration.publicationAmbiguous
                    ? STATE_MIXED_PUBLICATION
                    : registration.publicationFact ?? STATE_MUTATION_PUBLICATION;
                registration.publicationPending = false;
                registration.publicationFact = undefined;
                registration.publicationAmbiguous = false;
                observer.publication?.(fact);
            };
        }
        this.registrations.set(observer, registration);
        if (!observer.publication && !observer.ownRestore && !observer.restoreClaim) {
            this.patchOnly = registration;
        }
        this.single = this.registrations.size === 1 ? registration : undefined;
        if (!this.single) {
            this.fanout ??= (patch: Parameters<TPatchRecorder>[0]): void =>
                this.reportPatch(patch);
        }
        this.port.listener = this.single ? this.directPatch : this.fanout;
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
        this.pendingRestoreClaim = undefined;
        registration.publicationPending = false;
        registration.publicationFact = undefined;
        registration.publicationAmbiguous = false;
        this.registrations.delete(registration.observer);
        if (this.patchOnly === registration) {
            this.patchOnly = undefined;
        }
        this.single = this.registrations.size === 1
            ? this.registrations.values().next().value
            : undefined;
        this.port.listener = this.registrations.size === 0
            ? undefined
            : this.single ? this.directPatch : this.fanout;
    }

    /**
     * Preserves the custom-producer boolean contract as a projection of the canonical claim.
     *
     * @param state - exact restore argument whose endpoint may be adopted
     */
    public ownRestore(state: unknown): boolean {
        const claim = this.claimRestore(state);
        this.pendingRestoreClaim = claim ? {state, claim} : undefined;
        return claim?.adopt === true;
    }

    /** Consumes a custom producer's one-shot claim only for its exact restore argument.
     *
     * @param state - root presented to the installation boundary
     */
    public consumeRestoreClaim(state: unknown): IStateRestoreClaim | undefined {
        const pending = this.pendingRestoreClaim;
        this.pendingRestoreClaim = undefined;
        return pending && pending.state === state ? pending.claim : undefined;
    }

    /** Collects exact installation metadata while preserving every independent observer.
     *
     * @param state - exact restore argument whose owner metadata is required
     */
    public claimRestore(state: unknown): IStateRestoreClaim | undefined {
        this.pendingRestoreClaim = undefined;
        const generation = this.generation;
        let claim: IStateRestoreClaim | undefined;
        for (const registration of this.registrations.values()) {
            const observer = registration.observer;
            if (registration.generation > generation || this.registrations.get(observer) !== registration) {
                continue;
            }
            const adopted = observer.ownRestore?.(state);
            const candidate = observer.restoreClaim?.(state);
            if (candidate && claim === undefined) {
                claim = candidate;
            } else if (adopted === true) {
                claim ??= {representation: 'history-owned', adopt: true};
            }
        }
        return claim;
    }

    /**
     * Queues one registration's publication; returns the scheduler failure, if any.
     *
     * @param registration - the attachment whose callback is scheduled
     * @param fact - the closed transition fact, mixed in when one is already pending
     */
    private queuePublication(registration: IRegistration, fact: IStatePublication): unknown {
        if (!registration.deliverPublication || registration.schedulerKey === undefined) {
            return undefined;
        }
        if (!registration.publicationPending) {
            registration.publicationPending = true;
            registration.publicationFact = fact;
        } else {
            registration.publicationAmbiguous = true;
            registration.publicationFact = STATE_MIXED_PUBLICATION;
        }
        try {
            this.scheduler.schedule(registration.schedulerKey, registration.deliverPublication);
        } catch (error: unknown) {
            registration.publicationPending = false;
            registration.publicationFact = undefined;
            registration.publicationAmbiguous = false;
            return error;
        }
        return undefined;
    }

    /** Queues closed history boundaries before ordinary subscribers; failures do not starve another history.
     *
     * @param fact - closed transition fact, defaulting to an ordinary mutation
     */
    public publish(fact: IStatePublication = STATE_MUTATION_PUBLICATION): unknown[] | undefined {
        this.pendingRestoreClaim = undefined;
        const sole = this.single;
        if (sole) {
            const error = this.queuePublication(sole, fact);
            return error === undefined ? undefined : [error];
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
            const error = this.queuePublication(registration, fact);
            if (error !== undefined) {
                (failures ??= []).push(error);
            }
        }
        return failures;
    }
}
