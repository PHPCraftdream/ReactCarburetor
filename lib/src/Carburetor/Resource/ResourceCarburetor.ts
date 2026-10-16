import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData, IResourceSnapshot, TResourceArgs, TResourceKey, TResourceLoader} from "@/Carburetor/Models/Resource";
import {TSignalLoader} from "@/Carburetor/Resource/Keys/TSignalLoader";
import {defaultResourceKey} from "@/Carburetor/Resource/Keys/defaultResourceKey";
import {encodeResourceKeyValue} from "@/Carburetor/Resource/Keys/encodeResourceKeyValue";
import {validateResourceKey} from "@/Carburetor/Resource/Keys/validateResourceKey";
import {IResourceCarburetorOptions} from "./ResourceOptions";
import {validateResourceLimits} from "./validateResourceLimits";
import {dropEventArgs} from "./Slot/dropEventArgs";
import {TDisposer} from "@/Carburetor/Models/Base";
import {IStateInstallation, IStateRestoreClaim, IPatchObserver, STATE_PUBLIC_REPLACEMENT} from "@/Carburetor/Models/Paths";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {prepareSlotRequest} from "./Slot/prepareSlotRequest";
import {restoreSlotData} from "./Slot/restoreSlotData";
import {createAnswerMemory} from "./Slot/answerMemory";
import {createAbortHandle} from "./Slot/createAbortHandle";
import {getInitialResourceData} from "./Slot/getInitialResourceData";
import {prepareMemorySuccess} from "./Keys/prepareMemorySuccess";
import {applyResourceStatus} from "@/Carburetor/Resource/Status/applyResourceStatus";
import {describeError} from "@/Carburetor/Resource/Status/describeError";

const noop = (): void => undefined;

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
}

/**
 * An async value with an explicit status: loading and failure are part of the state, concurrent
 * loads with the same key share one request, and a fresh remembered answer becomes current
 * without a request. `suspend` serves only the key an answer actually settled under.
 */
export class ResourceCarburetor<T, TArgs extends TResourceArgs = []> extends Carburetor<IResourceData<T>> {
    /** Loader retained independently of subclass names. */
    public [R.loader]!: TResourceLoader<T, TArgs>;
    /** Request and answer ownership stays empty until the slot is first used. */
    private [R.runtime]: ISlotRuntime<T, TArgs> | undefined;
    /** Changes when a newer operation takes ownership during synchronous callbacks. */
    public [R.operationVersion]: number = 0;

    /** Allocates the shared runtime record only when the slot first needs one. */
    private [R.ensureRuntime](): ISlotRuntime<T, TArgs> {
        return this[R.runtime] ??= {};
    }

    /**
     * Takes the loader this resource calls, and starts out empty.
     *
     * @param loader - called with the arguments and an abort signal; a newer start aborts it
     * @param options - `key`, `ttl`, `maxEntries` and `scheduler`; omitted, the defaults apply
     */
    public constructor(
        loader: (...args: [...TArgs, AbortSignal]) => Promise<T>,
        options?: IResourceCarburetorOptions<TArgs>,
    );
    public constructor(
        loader: (...args: TArgs) => Promise<T>,
        options?: IResourceCarburetorOptions<TArgs>,
    );
    /** Loader arguments must be fixed-length without optional members; see `TSignalLoader`. */
    public constructor(loader: TSignalLoader<T, TArgs>, options?: IResourceCarburetorOptions<TArgs>);
    /**
     * Takes the loader this resource calls, and starts out empty.
     *
     * @param loader - called with the arguments and an abort signal; a newer start aborts it
     * @param options - `key`, `ttl`, `maxEntries` and `scheduler`; omitted, the defaults apply
     */
    public constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCarburetorOptions<TArgs> = {}) {
        validateResourceLimits(options.ttl, options.maxEntries);
        if (options.key !== undefined) validateResourceKey(options.key);
        super(getInitialResourceData<T>(), options.scheduler);
        this.memory = createAnswerMemory<T>(options.ttl, options.maxEntries);
        this.keyOption = options.key;
        // Handles are bound so an event handler may adopt them directly (D2).
        this.load = (...args: TArgs): Promise<void> => this[R.load](args);
        this.refresh = (...args: TArgs): Promise<void> => {
            const settled = dropEventArgs(args);
            return this[R.start](settled, false, true, this[R.keyOf](settled));
        };
        this.clear = (): void => this[R.clear]();
        this[R.loader] = loader;
    }

    /** Earlier successful answers by key; LRU-bounded, fresh by `ttl`, runtime-only (D1). */
    private memory: ReturnType<typeof createAnswerMemory<T>>;
    /** Custom key function from options; omitted, the default key derivation applies. */
    private readonly keyOption: TResourceKey<TArgs> | undefined;

    /** Starts a load, or joins the one already in flight for the same arguments (D2). */
    public load: (...args: TArgs) => Promise<void>;

    /** Always restarts the request for these arguments; stale answers reload through it (D2, D4). */
    public refresh: (...args: TArgs) => Promise<void>;

    /** Cancels in flight, drops the answer and the whole memory, back to Idle (D2). */
    public clear: () => void;

    /** The shared entry point behind the bound `load`: skip, memory hit, join, or request. */
    public [R.load](args: TArgs): Promise<void> {
        const settled = dropEventArgs(args);
        const key = this[R.keyOf](settled);
        const state = this.data;
        const answer = this[R.runtime]?.answer;
        if (state.status === EResourceStatus.Success && answer?.key === key
            && this[R.isFresh](state.updatedAt)) return Promise.resolve();
        // A request in flight for this key (e.g. a refresh) wins over a remembered answer.
        const current = this[R.runtime]?.request;
        if (current?.key === key) return current.promise;
        const remembered = this.memory.fresh(key);
        if (remembered) {
            // A memory hit takes ownership: the in-flight request of another key must not settle.
            const operationVersion = ++this[R.operationVersion];
            this[R.cancelInFlight]();
            if (this[R.operationVersion] !== operationVersion) return Promise.resolve();
            this[R.publishMemory](key, remembered, false);
            return Promise.resolve();
        }
        return this[R.start](settled, false, false, key);
    }

    /**
     * Records resource history as complete wire snapshots, including the private settled key.
     *
     * Opaque recording skips concrete payload construction while keeping exact write paths.
     *
     * @param observer - the history patch/publication observer
     */
    public attachPatchListener(observer: IPatchObserver): TDisposer {
        this[S.patchPort].opaque = true;

        return super.attachPatchListener(observer);
    }

    /**
     * A public whole-state replacement has no request key of its own and does not cancel a loader.
     *
     * @param data - state root adopted verbatim.
     */
    public setData(data: IResourceData<T>): IResourceData<T> {
        const replacing = data !== this.data;
        const keyChanged = replacing && this[R.runtime]?.answer?.key !== undefined;

        if (keyChanged) {
            return this[S.commitState](data, {
                origin: 'replacement', representation: 'public', wildcard: true,
            });
        }
        return this[S.commitState](data, STATE_PUBLIC_REPLACEMENT);
    }

    /**
     * The state plus the key its answer settled under: what travels across the serialization
     * boundary has to carry enough for the restored slot to tell which arguments the answer
     * belongs to.
     */
    public snapshot(): IResourceSnapshot<T> {
        return {...super.snapshot(), key: this[R.runtime]?.answer?.key};
    }

    /** Owns the raw state graph for history, including the wire key it adds. */
    public captureHistory(own: <V>(value: V) => V): IResourceSnapshot<T> {
        const state = own(this.getData());
        Object.defineProperty(state, 'key', {
            value: this[R.runtime]?.answer?.key, configurable: true, enumerable: true, writable: true,
        });
        return state;
    }

    /** The wire form: live data plus the settled answer key, without a copy.
     *
     * A detached copy is `snapshot()`.
     */
    public toJSON(): IResourceSnapshot<T> {
        return {...this.getData(), key: this[R.runtime]?.answer?.key};
    }

    /**
     * Installs a snapshot as the current state, and re-establishes the answer's identity
     * with it: the data alone says nothing about which arguments produced it.
     *
     * @param data - the snapshot to restore
     */
    public restore(data: IResourceSnapshot<T>): void {
        const operationVersion = ++this[R.operationVersion];
        this[R.cancelInFlight]();
        if (this[R.operationVersion] !== operationVersion) return;

        const claim: IStateRestoreClaim | undefined = this[S.patchObservers]?.claimRestore(data);
        const ownedReplay = claim?.adopt === true;
        const owner = claim?.owner;
        const settled = data.status === EResourceStatus.Success || data.status === EResourceStatus.Error;
        const nextKey = settled ? data.key : undefined;
        const keyChanged = this[R.runtime]?.answer?.key !== nextKey;

        // A restored Pending status has no live request behind it. Normalize it before
        // installation while preserving held history endpoints and their native backlinks.
        const status = data.status === EResourceStatus.Pending ? EResourceStatus.Idle : data.status;
        const nextData: IResourceData<T> = restoreSlotData(data, status, ownedReplay);

        const runtime = this[R.ensureRuntime]();
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
            this[S.commitState](nextData, installation);
        } catch (error: unknown) {
            if (this[R.operationVersion] === operationVersion && this.data !== nextData) {
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
        if (this[R.runtime]?.answer && this[R.runtime]!.answer!.owner !== this.data) {
            this[R.runtime]!.answer = undefined;
        }
        this[R.reconcileError]();
    }

    /** Reconciles draft/update writes before their subscribers see the published state. */
    protected preEmit(): void {
        this[R.reconcileError]();
    }

    /** Keep raw failure ownership attached only to the state and message that produced it. */
    private [R.reconcileError](): void {
        const state = this.data;
        const runtime = this[R.runtime];
        const answer = runtime?.answer;
        if (answer && answer.owner !== state) {
            answer.failure = undefined;
            answer.key = undefined;
            answer.owner = state;
        }
        if (state.status === EResourceStatus.Error) {
            if (!answer || !answer.failure || answer.failure.message !== state.error) {
                this[R.ensureRuntime]().answer = {
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
        return this[R.runtime]?.answer?.failure?.value;
    }

    /**
     * Reads the value, suspending while it loads and rethrowing when it failed.
     *
     * The Pending publication of a started request is deferred to a microtask because a render
     * must not notify subscribers; a fresh remembered answer is published deferred too, and its
     * data is returned right away.
     *
     * @param args - the loader arguments identifying the answer
     */
    public suspend(...args: TArgs): T {
        const state = this.data;
        const key = this[R.keyOf](args);
        const answer = this[R.runtime]?.answer;
        if (state.status === EResourceStatus.Success && answer?.key === key
            && this[R.isFresh](state.updatedAt)) return state.data as T;
        if (state.status === EResourceStatus.Error && answer?.key === key) {
            if (answer.failure) throw answer.failure.value;
            throw new Error(state.error || 'Carburetor: resource failed');
        }
        const request = this[R.runtime]?.request;
        if (request?.key === key) throw request.promise;
        const remembered = this.memory.fresh(key);
        if (remembered) {
            const operationVersion = ++this[R.operationVersion];
            this[R.cancelInFlight]();
            if (this[R.operationVersion] !== operationVersion) return remembered.data;
            this[R.publishMemory](key, remembered, true);
            return remembered.data;
        }
        throw this[R.start](args, true, false, key);
    }

    /** Cancels the request in flight; its result is ignored when it arrives. */
    public abort(): void {
        if (!this[R.runtime]?.request) return;
        const operationVersion = ++this[R.operationVersion];
        this[R.cancelInFlight]();
        if (this[R.operationVersion] !== operationVersion) return;
        if (this[R.runtime]) this[R.runtime]!.answer = undefined;
        applyResourceStatus(this.draft, EResourceStatus.Idle);
        this.emitUpdate();
    }

    /** Cancels in flight, drops the answer and the whole memory, back to the initial state. */
    public [R.clear](): void {
        const operationVersion = ++this[R.operationVersion];
        this[R.cancelInFlight]();
        if (this[R.operationVersion] !== operationVersion) return;
        this.memory.clear();
        const hadAnswer = this[R.runtime]?.answer !== undefined;
        if (this[R.runtime]) this[R.runtime]!.answer = undefined;
        this[S.commitState](getInitialResourceData<T>(), {
            origin: 'operational', owner: this[R.clearToken] ??= {},
            representation: 'owned-operational', wildcard: hadAnswer || undefined,
        });
    }
    /** Reused publication owner for clear(), so history does not accumulate tokens. */
    private [R.clearToken]?: object;

    /** Detach ownership before abort listeners run synchronously. */
    public [R.cancelInFlight](): void {
        const runtime = this[R.runtime];
        const request = runtime?.request;
        if (!runtime || !request) return;
        runtime.request = undefined;
        request.controller.abort();
    }

    /**
     * The one path into a request: it installs request ownership before publishing Pending.
     *
     * @param args - loader arguments; refresh() restarts these same arguments
     * @param deferNotification - true from suspend(), where notifying during render is unsafe
     * @param force - restart rather than join the same active key
     * @param key - the key already computed by the caller; computed here when omitted
     */
    public [R.start](
        args: TArgs, deferNotification: boolean, force = false, key?: string,
    ): Promise<void> {
        key ??= this[R.keyOf](args);
        const current = this[R.runtime]?.request;
        if (!force && current?.key === key) return current.promise;

        const stateBeforeAbort = this.data;
        const operationVersion = ++this[R.operationVersion];
        this[R.cancelInFlight]();
        const replacement = this[R.runtime]?.request;
        if (this[R.operationVersion] !== operationVersion || this.data !== stateBeforeAbort) {
            if (replacement?.key === key) return replacement.promise;
            return Promise.reject(createSupersededError());
        }

        const previousState = this.data;
        const previousStatus = previousState.status;
        const previousError = previousState.error;
        const previousAnswer = this[R.runtime]?.answer;
        const nextState = prepareSlotRequest(previousState);
        const controller = createAbortHandle();
        let resolveRequest!: () => void;
        let rejectRequest!: (error: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        const request: ISlotRequest<TArgs> = {key, args, controller, promise, generation: operationVersion};
        const runtime = this[R.ensureRuntime]();
        runtime.request = request;
        runtime.answer = undefined;

        try {
            if (nextState) {
                this[S.commitState](nextState, {
                    origin: 'operational',
                    owner: request,
                    representation: 'owned-operational',
                    publication: deferNotification ? 'deferred' : 'sync',
                });
            } else {
                applyResourceStatus(this.draft, EResourceStatus.Pending);
                if (this[R.isCurrent](request)) this.draft.error = undefined;
                if (this[R.isCurrent](request)) {
                    if (deferNotification) this.emitSoon();
                    else this.emitUpdate();
                }
            }
        } catch (error: unknown) {
            if (this[R.isCurrent](request)) {
                runtime.request = undefined;
                runtime.answer = previousAnswer;
                try {
                    controller.abort();
                } catch {
                    // Keep the publication failure as the request's rejection.
                }
                if (this[R.operationVersion] === operationVersion) {
                    try {
                        if (nextState && this.data === nextState) {
                            this[S.commitState](previousState, {
                                origin: 'operational', owner: request, representation: 'owned-operational',
                            });
                        } else if (this.data === previousState) {
                            try {
                                const draft = this.draft;
                                applyResourceStatus(draft, previousStatus);
                                draft.error = previousError;
                            } finally {
                                this.emitUpdate();
                            }
                        }
                    } catch {
                        // Preserve the original failure after best-effort visible-state recovery.
                    }
                }
            }
            void promise.catch(noop);
            rejectRequest(error);
            return promise;
        }

        if (!this[R.isCurrent](request)) {
            rejectRequest(createSupersededError());
            return promise;
        }

        let answer: Promise<T>;
        try {
            // The union loader type is not directly callable; the runtime always passes the signal.
            answer = (this[R.loader] as (...args: readonly unknown[]) => Promise<T>)(...args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }
        void answer.then(
            (data: T) => this[R.settleSuccess](request, data),
            (error: unknown) => this[R.settleError](request, error)
        ).then(resolveRequest, rejectRequest);
        return promise;
    }

    /** The identity of a set of arguments, for telling one request from another. */
    public [R.keyOf](args: TArgs): string {
        if (this.keyOption) return encodeResourceKeyValue(this.keyOption(...args));
        return defaultResourceKey(args);
    }

    /** Whether an answer at `updatedAt` is still usable without a new request (D4). */
    private [R.isFresh](updatedAt: number | undefined): boolean {
        return this.memory.isFresh(updatedAt);
    }

    /** Makes a remembered answer the current one, published once; deferred in render.
     *
     * @param key - the key the remembered answer was stored under
     * @param remembered - the remembered answer to publish
     * @param deferNotification - true from suspend(), where notifying during render is unsafe
     */
    private [R.publishMemory](
        key: string, remembered: {data: T; updatedAt: number}, deferNotification: boolean,
    ): void {
        const runtime = this[R.ensureRuntime]();
        const keyChanged = runtime.answer?.key !== key;
        const previousState = this.data;
        const nextState = prepareMemorySuccess(previousState, remembered);
        const installation: IStateInstallation = {
            origin: 'operational', owner: this[R.memoryToken] ??= {},
            representation: 'owned-operational', publication: deferNotification ? 'deferred' : 'sync',
        };
        try {
            if (nextState) {
                // Owned graph like a request; key set first so sync history/subscribers see it.
                runtime.answer = {key, owner: nextState};
                this[S.commitState](nextState, keyChanged ? {...installation, wildcard: true} : installation);
            } else {
                runtime.answer = {key, owner: previousState};
                const draft = this.draft;
                applyResourceStatus(draft, EResourceStatus.Success);
                draft.data = remembered.data;
                draft.error = undefined;
                draft.updatedAt = remembered.updatedAt;
                // Nothing but the key moved: force the publication restore() uses for key changes.
                if (keyChanged) this[S.commitState](this.data, {...installation, wildcard: true});
                else if (deferNotification) this.emitSoon();
                else this.emitUpdate();
            }
        } catch (error: unknown) {
            if (runtime.answer?.owner !== this.data) runtime.answer = undefined;
            throw error;
        }
    }
    /** Reused publication owner for memory hits, so history does not accumulate tokens. */
    private [R.memoryToken]?: object;

    /** Whether this exact request still owns the slot. */
    public [R.isCurrent](request: ISlotRequest<TArgs>): boolean {
        return this[R.runtime]?.request === request && !request.controller.signal.aborted;
    }

    /** Store the value returned by the request that still owns this slot.
     *
     * @param request - the request whose answer is being stored
     * @param data - the answer the loader resolved with
     */
    public [R.settleSuccess](request: ISlotRequest<TArgs>, data: T): void {
        if (!this[R.isCurrent](request)) return;
        const runtime = this[R.ensureRuntime]();
        runtime.request = undefined;
        runtime.answer = {key: request.key, owner: this.data};
        try {
            const now = Date.now();
            const draft = this.draft;
            applyResourceStatus(draft, EResourceStatus.Success);
            draft.data = data;
            draft.error = undefined;
            draft.updatedAt = now;
            this.memory.remember(request.key, data, now);
        } finally {
            this.emitUpdate();
        }
    }

    /**
     * Store the raw rejection with explicit presence, even when its value is undefined.
     *
     * @param request - the request whose failure is being stored
     * @param error - the rejection reason thrown by the failed request
     */
    public [R.settleError](request: ISlotRequest<TArgs>, error: unknown): void {
        if (!this[R.isCurrent](request)) return;
        const runtime = this[R.ensureRuntime]();
        let message: string;
        let thrown: {error: unknown} | undefined;
        try {
            message = describeError(error);
        } catch (descriptionError: unknown) {
            message = 'Carburetor: resource failed';
            thrown = {error: descriptionError};
        }
        if (this[R.runtime] !== runtime || this[R.operationVersion] !== request.generation
            || !this[R.isCurrent](request)) {
            if (thrown) throw thrown.error;
            return;
        }
        runtime.request = undefined;
        runtime.answer = {key: request.key, owner: this.data, failure: {value: error, message}};
        // A failed answer for this key must not be served from memory again (D4).
        this.memory.forget(request.key);
        try {
            const draft = this.draft;
            applyResourceStatus(draft, EResourceStatus.Error);
            draft.error = message;
            draft.updatedAt = Date.now();
        } finally {
            this.emitUpdate();
        }
        if (thrown) throw thrown.error;
    }
}
