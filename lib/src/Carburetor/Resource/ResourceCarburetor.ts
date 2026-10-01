import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData, IResourceSnapshot, TResourceLoader} from "@/Carburetor/Models/Resource";
import {TDisposer} from "@/Carburetor/Models/Base";
import {
    IStateInstallation, IStateRestoreClaim, IPatchObserver, STATE_PUBLIC_REPLACEMENT,
} from "@/Carburetor/Models/Paths";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {cloneOwnedGraph} from "@/Carburetor/Store/Utils/Graph/cloneOwnedGraph";
import {getInitialResourceData} from "./getInitialResourceData";
import {createAbortHandle} from "./createAbortHandle";
import {prepareSlotRequest} from "./prepareSlotRequest";

/** The message a failure is stored under: the state has to stay serializable. */
const describeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};

/** A request that never reached its loader rejects as cancelled instead of appearing successful. */
const createSupersededError = (): Error => {
    const error = new Error('Resource request was superseded before it started');

    error.name = 'AbortError';

    return error;
};

interface ISlotRequest<TArgs> {
    key: string;
    args: TArgs;
    controller: AbortController;
    promise: Promise<void>;
    generation: number;
}

interface ISlotAnswer<T> {
    key: string | undefined;
    owner: IResourceData<T>;
    failure?: {value: unknown; message: string | undefined};
}

interface ISlotRuntime<T, TArgs> {
    request?: ISlotRequest<TArgs>;
    answer?: ISlotAnswer<T>;
    last?: {key: string; args: TArgs};
}

/**
 * An async value with an explicit status, so loading and failure are part of the state
 * rather than something every component reinvents. Concurrent loads with the same
 * arguments share one request; a load with different arguments aborts the previous one.
 *
 * The slot holds one answer, and `suspend` serves it only for the key it actually
 * settled: reading with any other key starts a fresh request instead of handing over
 * the previous record's data.
 */
export class ResourceCarburetor<T, TArgs = void> extends Carburetor<IResourceData<T>> {
    /** Request and answer ownership stays empty until the slot is first used. */
    private runtime: ISlotRuntime<T, TArgs> | undefined;
    /** Changes when a newer operation takes ownership during synchronous callbacks. */
    protected operationVersion: number = 0;

    /** Allocates the shared runtime record only when the slot first needs one. */
    private ensureRuntime(): ISlotRuntime<T, TArgs> {
        return this.runtime ??= {};
    }

    /**
     * Takes the loader this resource calls, and starts out empty.
     *
     * @param loader - called with the arguments and an abort signal; the single slot means a newer
     * start aborts it, so two of its runs are never alive at once
     * @param scheduler - the policy deciding when subscribers are woken; omitted, updates publish
     * synchronously on each write
     */
    constructor(protected loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler) {
        super(getInitialResourceData<T>(), scheduler);
    }

    /**
     * Records resource history as complete wire snapshots, including the private settled key.
     *
     * Opaque recording skips concrete payload construction while keeping exact write paths.
     *
     * @param observer - the history patch/publication observer
     */
    public attachPatchListener(observer: IPatchObserver): TDisposer {
        this.patchPort.opaque = true;

        return super.attachPatchListener(observer);
    }

    /**
     * A public whole-state replacement has no request key of its own and does not cancel a loader.
     *
     * @param data - state root adopted verbatim.
     */
    public setData(data: IResourceData<T>): IResourceData<T> {
        const replacing = data !== this.data;
        const keyChanged = replacing && this.runtime?.answer?.key !== undefined;

        if (keyChanged) {
            return this.commitState(data, {
                origin: 'replacement', representation: 'public', wildcard: true,
            });
        }
        return this.commitState(data, STATE_PUBLIC_REPLACEMENT);
    }

    /**
     * The state plus the key its answer settled under: what travels across the serialization
     * boundary has to carry enough for the restored slot to tell which arguments the answer
     * belongs to.
     */
    public snapshot(): IResourceSnapshot<T> {
        return {...super.snapshot(), key: this.runtime?.answer?.key};
    }

    /** Own the raw state graph before adding wire metadata, retaining native links to its root.
     *
     * @param own - detaches the complete live state before its settled key is included
     */
    public captureHistory(own: <V>(value: V) => V): IResourceSnapshot<T> {
        if (this.snapshot !== ResourceCarburetor.prototype.snapshot) {
            throw new Error('CarburetorHistory: a custom snapshot() must provide captureHistory()');
        }
        const state = own(this.getData());
        Object.defineProperty(state, 'key', {
            value: this.runtime?.answer?.key, configurable: true, enumerable: true, writable: true,
        });
        return state;
    }

    /** The settled key belongs to the wire answer, not the live slot's data. */
    public serialize(): string {
        return JSON.stringify({...this.getData(), key: this.runtime?.answer?.key});
    }

    /**
     * Installs a snapshot as the current state, and re-establishes the answer's identity
     * with it: the data alone says nothing about which arguments produced it.
     *
     * @param data - the snapshot to restore
     */
    public restore(data: IResourceSnapshot<T>): void {
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        if (this.operationVersion !== operationVersion) return;

        const claim: IStateRestoreClaim | undefined = this.patchObservers?.claimRestore(data);
        const ownedReplay = claim?.adopt === true;
        const owner = claim?.owner;
        const settled = data.status === EResourceStatus.Success || data.status === EResourceStatus.Error;
        const nextKey = settled ? data.key : undefined;
        const keyChanged = this.runtime?.answer?.key !== nextKey;

        // A restored Pending status has no live request behind it. Normalize it before
        // installation while preserving held history endpoints and their native backlinks.
        const status = data.status === EResourceStatus.Pending ? EResourceStatus.Idle : data.status;
        let nextData: IResourceData<T>;
        if (ownedReplay) {
            const statusDescriptor = data.status !== status
                ? Object.getOwnPropertyDescriptor(data, 'status') : undefined;
            if (statusDescriptor?.writable === false && statusDescriptor.configurable === false) {
                nextData = cloneOwnedGraph(data, undefined, (source, key, descriptor) => {
                    if (source !== data) return descriptor;
                    if (key === 'key') return undefined;
                    if (key === 'status') descriptor.value = status;
                    return descriptor;
                });
            } else {
                if (statusDescriptor?.writable === false) {
                    statusDescriptor.value = status;
                    Object.defineProperty(data, 'status', statusDescriptor);
                } else if (data.status !== status) {
                    data.status = status;
                }
                delete data.key;
                nextData = data;
            }
        } else {
            nextData = deepClone({status, data: data.data, error: data.error, updatedAt: data.updatedAt});
        }

        const runtime = this.ensureRuntime();
        const previousAnswer = runtime.answer;
        runtime.answer = status === EResourceStatus.Success || status === EResourceStatus.Error
            ? {
                key: nextKey,
                owner: nextData,
                ...(status === EResourceStatus.Error
                    ? {failure: {value: new Error(nextData.error || ''), message: nextData.error}}
                    : {}),
            }
            : undefined;
        const installation: IStateInstallation = {
            origin: 'restore',
            owner,
            representation: claim?.representation ?? 'public',
            wildcard: keyChanged ? true : undefined,
        };
        try {
            this.commitState(nextData, installation);
        } catch (error: unknown) {
            if (this.operationVersion === operationVersion && this.data !== nextData) {
                runtime.answer = previousAnswer;
            }
            throw error;
        }
    }

    /**
     * Hydration goes through restore(), not the base fromJSON's adopt-and-diff shortcut: only
     * restore() re-establishes the answer's key and normalizes a restored Pending status.
     *
     * @param value - the serialized snapshot; the cast is the caller's promise about the shape
     */
    public fromJSON(value: unknown): void {
        this.restore(value as IResourceSnapshot<T>);
    }

    /** Whole-root installation reconciles failure ownership before patch observers run. */
    protected didSetData(): void {
        if (this.runtime?.answer && this.runtime.answer.owner !== this.data) {
            this.runtime.answer = undefined;
        }
        this.reconcileError();
    }

    /** Reconciles draft/update writes before their subscribers see the published state. */
    protected preEmit(): void {
        this.reconcileError();
    }

    /** Keep raw failure ownership attached only to the state and message that produced it. */
    private reconcileError(): void {
        const state = this.data;
        const runtime = this.runtime;
        const answer = runtime?.answer;
        if (answer && answer.owner !== state) {
            answer.failure = undefined;
            answer.key = undefined;
            answer.owner = state;
        }
        if (state.status === EResourceStatus.Error) {
            if (!answer || !answer.failure || answer.failure.message !== state.error) {
                this.ensureRuntime().answer = {
                    key: answer?.key,
                    owner: state,
                    failure: {value: new Error(state.error || ''), message: state.error},
                };
            }
        } else if (answer) {
            answer.failure = undefined;
        }
    }

    /** The raw rejection value, which the serializable state cannot carry. */
    public getLastError(): unknown {
        return this.runtime?.answer?.failure?.value;
    }

    /**
     * Reads the value, suspending while it loads and rethrowing when it failed.
     *
     * The request is started on first read, and its Pending publication is deferred to a
     * microtask because a render must not notify subscribers.
     *
     * @param args - the loader arguments identifying the answer
     */
    public suspend(args: TArgs): T {
        const state = this.data;
        const key = this.keyOf(args);
        const answer = this.runtime?.answer;
        if (state.status === EResourceStatus.Success && answer?.key === key) return state.data as T;
        if (state.status === EResourceStatus.Error && answer?.key === key) {
            if (answer.failure) throw answer.failure.value;
            throw new Error(state.error || 'Carburetor: resource failed');
        }
        const request = this.runtime?.request;
        if (request?.key === key) throw request.promise;
        throw this.start(args, true);
    }

    /** Starts a load, or joins the one already in flight for the same arguments.
     *
     * @param args - loader arguments identifying the answer.
     */
    public load(args: TArgs): Promise<void> {
        return this.start(args, false);
    }

    /** Repeats the last load with the same arguments. */
    public reload(): Promise<void> {
        const last = this.runtime?.last;
        if (!last) return Promise.resolve();
        return this.start(last.args, false, true);
    }

    /** Cancels the request in flight; its result is ignored when it arrives. */
    public abort(): void {
        if (!this.runtime?.request) return;
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        if (this.operationVersion !== operationVersion) return;
        if (this.runtime) this.runtime.answer = undefined;
        this.draft.status = EResourceStatus.Idle;
        this.emitUpdate();
    }

    /** Detach ownership before abort listeners run synchronously. */
    protected cancelInFlight(): void {
        const runtime = this.runtime;
        const request = runtime?.request;
        if (!runtime || !request) return;
        runtime.request = undefined;
        request.controller.abort();
    }

    /**
     * The one path into a request: it installs request ownership before publishing Pending.
     *
     * @param args - loader arguments; reload() repeats these same arguments
     * @param deferNotification - true from suspend(), where notifying during render is unsafe
     * @param force - restart rather than join the same active key.
     */
    protected start(args: TArgs, deferNotification: boolean, force: boolean = false): Promise<void> {
        const key = this.keyOf(args);
        const current = this.runtime?.request;
        if (!force && current?.key === key) return current.promise;

        const stateBeforeAbort = this.data;
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        const replacement = this.runtime?.request;
        if (this.operationVersion !== operationVersion || this.data !== stateBeforeAbort) {
            if (replacement?.key === key) return replacement.promise;
            return Promise.reject(createSupersededError());
        }

        const previousState = this.data;
        const previousStatus = previousState.status;
        const previousError = previousState.error;
        const previousAnswer = this.runtime?.answer;
        const previousLast = this.runtime?.last;
        const nextState = prepareSlotRequest(previousState);
        const controller = createAbortHandle();
        let resolveRequest!: () => void;
        let rejectRequest!: (error: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        const request: ISlotRequest<TArgs> = {key, args, controller, promise, generation: operationVersion};
        const runtime = this.ensureRuntime();
        runtime.request = request;
        runtime.last = {key, args};
        runtime.answer = undefined;

        try {
            if (nextState) {
                this.commitState(nextState, {
                    origin: 'operational',
                    owner: request,
                    representation: 'owned-operational',
                    publication: deferNotification ? 'deferred' : 'sync',
                });
            } else {
                this.draft.status = EResourceStatus.Pending;
                if (this.isCurrent(request)) this.draft.error = undefined;
                if (this.isCurrent(request)) {
                    if (deferNotification) this.emitSoon();
                    else this.emitUpdate();
                }
            }
        } catch (error: unknown) {
            if (this.isCurrent(request)) {
                runtime.request = undefined;
                runtime.answer = previousAnswer;
                runtime.last = previousLast;
                try {
                    controller.abort();
                } catch {
                    // Keep the publication failure as the request's rejection.
                }
                if (this.operationVersion === operationVersion) {
                    try {
                        if (nextState && this.data === nextState) {
                            this.commitState(previousState, {
                                origin: 'operational', owner: request, representation: 'owned-operational',
                            });
                        } else if (this.data === previousState) {
                            this.update((draft) => {
                                draft.status = previousStatus;
                                draft.error = previousError;
                            });
                        }
                    } catch {
                        // Preserve the original failure after best-effort visible-state recovery.
                    }
                }
            }
            void promise.catch(() => undefined);
            rejectRequest(error);
            return promise;
        }

        if (!this.isCurrent(request)) {
            rejectRequest(createSupersededError());
            return promise;
        }

        let answer: Promise<T>;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }
        void answer.then(
            (data: T) => this.settleSuccess(request, data),
            (error: unknown) => this.settleError(request, error)
        ).then(resolveRequest, rejectRequest);
        return promise;
    }

    /** The identity of a set of arguments, for telling one request from another.
     *
     * @param args - arguments to serialize as the request key.
     */
    protected keyOf(args: TArgs): string {
        return JSON.stringify(args === undefined ? null : args);
    }

    /** Whether this exact request still owns the slot.
     *
     * @param request - request owner to compare.
     */
    protected isCurrent(request: ISlotRequest<TArgs>): boolean {
        return this.runtime?.request === request && !request.controller.signal.aborted;
    }

    /** Store the value returned by the request that still owns this slot.
     *
     * @param request - request owner reporting the value.
     * @param data - loader value adopted verbatim.
     */
    protected settleSuccess(request: ISlotRequest<TArgs>, data: T): void {
        if (!this.isCurrent(request)) return;
        const runtime = this.ensureRuntime();
        runtime.request = undefined;
        runtime.answer = {key: request.key, owner: this.data};
        this.update((draft) => {
            draft.status = EResourceStatus.Success;
            draft.data = data;
            draft.error = undefined;
            draft.updatedAt = Date.now();
        });
    }

    /** Store the raw rejection with explicit presence, even when its value is undefined.
     *
     * @param request - request owner reporting the failure.
     * @param error - raw rejected value.
     */
    protected settleError(request: ISlotRequest<TArgs>, error: unknown): void {
        if (!this.isCurrent(request)) return;
        const message = describeError(error);
        const runtime = this.ensureRuntime();
        runtime.request = undefined;
        runtime.answer = {key: request.key, owner: this.data, failure: {value: error, message}};
        this.update((draft) => {
            draft.status = EResourceStatus.Error;
            draft.error = message;
            draft.updatedAt = Date.now();
        });
    }
}
