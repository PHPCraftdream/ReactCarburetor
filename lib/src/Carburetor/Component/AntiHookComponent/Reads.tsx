"use client";

import {C} from "@/Carburetor/Component/Models/ComponentSymbols";

import {TReadonly} from "@/Carburetor/Models/Base";
import {TPath} from "@/Carburetor/Models/Paths";
import {transferCompletedReads} from "@/Carburetor/Store/Tracking/Observation/transferCompletedReads";
import {completeReads} from "@/Carburetor/Store/Tracking/Observation/completeReads";
import {readCoverage} from "@/Carburetor/Store/Paths/Markers/readCoverage";
import {sameReads} from "@/Carburetor/Store/Tracking/Observation/sameReads";
import {IComputed} from "@/Carburetor/Models/Derived";
import {getComputedSnapshotVersion} from "@/Carburetor/Derived/Freshness/getComputedSnapshotVersion";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {isCacheSupersededError} from "@/Carburetor/Resource/Cache/Reader/isCacheSupersededError";
import {resourceReader} from "@/Carburetor/Resource/Cache/Reader/resourceReader";
import {TResourceArgs, IResourceSource, IResourceView} from "@/Carburetor/Models/Resource";
import {IReadableCarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {
    IAttemptEntry,
    IConnection,
    IConnectionSource,
    IRenderAttempt,
} from "@/Carburetor/Component/Models/Connection";
import {buildTrackedView} from "@/Carburetor/Component/AntiHookComponent/buildTrackedView";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import {reportLiveViewEscape} from "@/Carburetor/Component/Connection/reportLiveViewEscape";
import {reuseSelection} from "@/Carburetor/Store/Utils/Selection/Patch/reuseSelection";
import {TargetsHold} from "@/Carburetor/Store/Utils/Selection/Patch/TargetsHold";
import {reconcileSelection} from "@/Carburetor/Store/Utils/Selection/reconcileSelection";
import {reconcileFlatSelection} from "@/Carburetor/Store/Utils/Selection/reconcileFlatSelection";
import {rejectArraySubclass} from "@/Carburetor/Store/Utils/Selection/rejectArraySubclass";
import {TCompletedReads} from "@/Carburetor/Store/Tracking/Observation/Models";
import {getSelectionAttemptIdentity} from "@/Carburetor/Component/Models/getSelectionAttemptIdentity";
import {AntiHookComponentFoundation} from "./Foundation";

export abstract class AntiHookComponentReads<P = {}, S = {}> extends AntiHookComponentFoundation<P, S> {
    /**
     * Resolved via the prototype chain on `AntiHookComponentSubscriptions`, the fragment that
     * owns connection re-filing; declared here because the equal-value wake path below calls it.
     */
    public abstract [C.migrateConnectionReads](connection: IConnection, reads: TCompletedReads, version: number): void;

    /** Live accessor for the recorder built into a cached view, whose call site is long gone. */
    private readonly [C.getRenderAttempt] = (): IRenderAttempt | undefined => this[C.renderAttempt];

    /** The general way to read state in render: returns tracked data; subscribes to exactly
     * the fields it actually reads, and re-renders only when those fields change.
     *
     * The view is the same object across renders while the carburetor and its data object
     * stay the same; `setData`/`restore` rebuild it. Reads outside the attempt that last
     * called this method record nothing.
     */
    public useCarburetor<T extends object>(carburetor: IReadableCarburetor<T>): TReadonly<T> {
        const attempt = this[C.renderAttempt];
        const entry = this[C.track](carburetor);

        if (this[C.trackedViews] === undefined) {
            this[C.trackedViews] = new WeakMap();
        }

        return buildTrackedView(this[C.trackedViews]!, carburetor, this[C.getRenderAttempt], attempt, entry);
    }

    /**
     * Declares one connect()-family connection into this component's persistent list and builds
     * its per-attempt source resolver and recorder.
     */
    private [C.declareConnection]<T extends object>(
        source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>)
    ): IConnectionSource<T> {
        return declareConnection(this[C.connections], this[C.getRenderAttempt], source);
    }

    /** A persistent view of a carburetor's data, declared once and read directly in render.
     *
     * `useCarburetor` also keeps a persistent root view per carburetor (see `buildTrackedView`),
     * rebuilt only when its data object changes — but it is looked up by carburetor identity on
     * every call, and declared inline in render. `connect()` instead builds the view once (a
     * class field initializer is the intended call site) and hands back the exact same object
     * for as long as the underlying data object does not change; what changes per render is
     * only what the proxy's recorder collects: a read counts while a render attempt is open —
     * the same boundary `useCarburetor` records under — so a conditional branch reading a
     * different field next render still narrows or widens the subscription.
     *
     * The view stays live across `setData`/`restore`: those replace the store's data object
     * wholesale, which this method notices (the cached proxy is rebuilt only when the object it
     * wraps has actually changed) and rebuilds transparently — the returned reference itself
     * never changes, only what it reads through.
     *
     * The declaration itself must not subscribe: React can construct an instance and later
     * decide never to commit it (see the class docstring's link to React's component contract),
     * so any side effect here would leak a subscription for a component that never mounted. All
     * subscription bookkeeping happens in `commitSubscriptions`/`releaseSubscriptions`, driven
     * by the attempt a commit consumes: the recorder captures the source and its baseline
     * version at the attempt's first read, and the commit publishes them as the connection's
     * committed description; a commit whose attempt never touched the connection clears that
     * description — ending the subscription but not the declaration, which a later render
     * re-arms simply by reading it again.
     *
     * A root data type this engine cannot proxy (see `isTrackable`) is read once, untracked, at
     * the moment the underlying object is (re)built — not fresh every render — so this method
     * inherits `read()`'s existing wildcard fallback but only re-triggers it on a data swap; a
     * store shaped that way should prefer `useCarburetor`, called directly in render.
     *
     * The facade's object/array kind is decided once, at declaration, from the source's
     * current root: the source is probed once here — nothing records, no render attempt is
     * open, and nothing subscribes — an array root declares an array-shaped view
     * (`Array.isArray` true, `JSON.stringify` serializes it as an array), and anything else
     * declares an object-shaped one. The kind then never changes — a Proxy target is fixed
     * at creation — so a source that is not resolvable yet (a scope-backed resolver resolves
     * only after construction, when React fills context) fixes the object shape, and a later
     * root whose kind disagrees fails with an explicit boundary error instead of serving a
     * silently incompatible view. Descriptors are forwarded through the same live view, with
     * non-configurable ones reported configurable — the only lawful answer over an empty
     * target — which is safe because every mutation trap, including prototype and extension
     * changes, is rejected.
     *
     * @param source - the carburetor to read, or a function resolving it at each attempt's
     * first read so a prop swap re-points the connection at the new store
     */
    public connect<T extends object>(source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>)): TReadonly<T> {
        const declared = this[C.declareConnection](source);

        return buildPersistentView(declared);
    }

    /** A typed selection of this component's connected data, safe to hand a child gated by
     * shallow props comparison — an external `React.memo` component, or this base class's own
     * props gate.
     *
     * Declare once as a field initializer, call the returned function in render:
     *
     * ```tsx
     * private readonly row = this.connectSelection(
     *     () => this.props.carburetor,
     *     (data) => ({title: data.items[this.props.id].title})
     * );
     *
     * render() {
     *     return <MemoRow todo={this.row()} />;
     * }
     * ```
     *
     * `select` reads the same tracked view `connect` hands out, so its reads land in this
     * render's attempt and the component subscribes to exactly the paths the selection
     * touches. Plain objects (own enumerable string keys) and arrays are copied recursively;
     * ordinary Map/Set/Date values are detached too, preserving aliases within the snapshot.
     *
     * The snapshot is reused while selected plain content, prototypes and reference-sharing
     * topology match; a detached Date compares by time, a Map/Set by content over primitive keys.
     * Class instances and object-keyed collections conservatively count as changed.
     *
     * The selector runs on every call, including every render, because that is what keeps this
     * render's read set — and with it, the subscription the next update needs — fresh; the
     * internal cache is about identity only and never skips a read (a skipped read would drop
     * the connection's dependencies and strand the child).
     *
     * Plain/array view branches are copied safely. An opaque live facade that cannot be detached
     * is reported once per selection in development; project its plain fields instead.
     *
     * @param source - the carburetor to read, or a function resolving it at each attempt's
     * first read so a prop swap re-points the connection at the new store
     * @param select - picks the part of the data this child consumes; runs on every call
     */
    public connectSelection<T extends object, R>(
        source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>),
        select: (data: TReadonly<T>) => R
    ): (() => TReadonly<R>) {
        const declared = this[C.declareConnection](source);
        const view = buildPersistentView(declared);

        let snapshot: {value: R} | undefined = undefined;
        let snapshotIdentity: symbol | undefined;
        let escapeReported = false;
        // What the snapshot mirrors, for R36-01's reuse: the live result, its ledger, and whether it is a tree.
        let live: unknown = undefined;
        let ledger: WeakMap<object, unknown> | undefined;
        let patchable = false;

        // R36-02: a write to a path the selection read wakes this connection, not the owner. The
        // selector re-runs outside any render attempt; the owner re-renders only when the snapshot
        // moves; equal snapshots migrate closed reads; a throw or no description takes the plain path.
        const connection = declared.connection;
        const selectionUnchanged = (): boolean => {
            const committed = connection.committed;

            const owner = this[C.committedAttempt];
            if (snapshot === undefined || committed === undefined || owner === undefined
                || this[C.renderAttempt] !== undefined || this[C.pendingAttempt] !== owner
                || snapshotIdentity === undefined || snapshotIdentity !== owner.selectionIdentity
                || this.props !== owner.props || this.state !== owner.state) {
                return false;
            }

            const version = committed.carburetor.getVersion();
            if (declared.getCarburetor() !== committed.carburetor) return false;
            const scratch = new Set<TPath>();
            let unchanged = false;

            declared.scratch = scratch;

            try {
                const next = select(view);

                const movedLive = next === live && next !== null && typeof next === 'object';
                const flat = movedLive ? undefined : reconcileFlatSelection(snapshot.value, next);
                unchanged = !movedLive && (flat !== undefined ? flat.value === snapshot.value :
                    reconcileSelection(snapshot.value, next, undefined, rejectArraySubclass) === snapshot.value);
            } catch {
                unchanged = false;
            } finally {
                declared.scratch = undefined;
            }

            if (!unchanged || this[C.renderAttempt] !== undefined
                || this[C.pendingAttempt] !== owner || this[C.committedAttempt] !== owner
                || this.props !== owner.props || this.state !== owner.state
                || connection.installed === undefined) {
                return false;
            }

            const reads = completeReads(scratch);

            if (sameReads(committed.reads, reads)) {
                // Verified at `version`: the next commit's drift check starts from here.
                committed.baselineVersion = version;

                return true;
            }

            // R37-06: an equal-valued branch switch — the selection reconciled to the same
            // snapshot, only the read set moved. Migrate read ownership here, the way `watch`
            // re-files on an equal-value wake, instead of forceUpdating the owner just to
            // re-file at the next commit. A source swap (the resolver now names another
            // carburetor than the one committed) still takes the plain re-render: moving the
            // subscription across sources here would have to guess at the new baseline.
            if (declared.getCarburetor() !== committed.carburetor) {
                return false;
            }

            this[C.migrateConnectionReads](connection, reads, version);

            return true;
        };

        connection.wake = (): void => {
            if (connection.installed === undefined) return;
            if (!selectionUnchanged()) {
                this.forceUpdate();
            }
        };

        return (): TReadonly<R> => {
            snapshotIdentity = getSelectionAttemptIdentity(this[C.renderAttempt]);
            const next: R = select(view);

            const previous = snapshot === undefined ? undefined : snapshot.value;

            // R36-01: the same live view as last render: no related write keeps the snapshot as is,
            // a related one is patched from the write log, and the filed read set is adopted.
            if (previous !== undefined && next === live && next !== null && typeof next === 'object'
                && ledger !== undefined) {
                const committed = connection.committed;
                const entry = connection.attemptEntry;
                const ownReads = entry?.reads;
                let candidate: Set<TPath> | undefined;
                if (committed !== undefined && entry !== undefined && !entry.sharedReads
                    && committed.carburetor === entry.source) {
                    for (const path of entry.reads) {
                        if (!committed.reads.has(path) && readCoverage.covers(committed.reads, path)) {
                            candidate ??= new Set(entry.reads);
                            candidate.delete(path);
                        }
                    }
                    if (candidate !== undefined) {
                        entry.reads = candidate;
                        candidate.add = (path: TPath): Set<TPath> => {
                            ownReads!.add(path);
                            if (!readCoverage.covers(committed.reads, path)) Set.prototype.add.call(candidate, path);
                            return candidate!;
                        };
                    }
                }
                const selectionReads = entry?.reads;
                let reused: R | undefined;
                try {
                    reused = reuseSelection(connection, previous, next, ledger, patchable);
                } finally {
                    // Rejected reuse must not retire dependencies using somebody else's coverage.
                    if (candidate !== undefined && entry !== undefined && entry.reads === candidate) {
                        for (const path of candidate) ownReads!.add(path);
                        entry.reads = ownReads!;
                    }
                }

                if (reused !== undefined) {
                    if (entry !== undefined && committed !== undefined && !entry.sharedReads) {
                        completeReads(selectionReads!);
                        if (Array.from(selectionReads!).every(path => readCoverage.covers(committed.reads, path))) {
                            entry.reads = committed.reads as unknown as Set<TPath>;
                            entry.sharedReads = true;
                        }
                    }
                    if (connection.attemptEntry !== undefined) connection.attemptEntry.targetsWanted = true;
                    snapshot = {value: reused};

                    return reused as TReadonly<R>;
                }
            }

            // The development escape search walks the selection, so a reused snapshot skips it.
            if (IS_DEVELOPMENT && !escapeReported) {
                escapeReported = reportLiveViewEscape(next);
            }

            const trace = {shared: false};
            const objectResult = next !== null && typeof next === 'object';
            const flat = reconcileFlatSelection(previous, next);
            const nextLedger = flat !== undefined
                ? undefined
                : objectResult ? new WeakMap<object, unknown>() : undefined;
            // Tentative until the render attempt commits; abandoned renders cannot change the holder.
            if (nextLedger !== undefined) connection.targets ??= new TargetsHold();

            snapshot = {
                value: flat !== undefined ? flat.value as R : reconcileSelection(
                    previous, next, undefined, rejectArraySubclass, previous === undefined ? undefined : ledger,
                    nextLedger, trace
                ) as R,
            };
            if (connection.attemptEntry !== undefined) {
                connection.attemptEntry.targetsWanted = nextLedger !== undefined;
            }
            live = next;
            ledger = nextLedger;
            patchable = flat !== undefined || !trace.shared;

            return snapshot.value as TReadonly<R>;
        };
    }

    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    public useComputed<R extends unknown>(computed: IComputed<R>): R {
        const entry = this[C.track](computed);
        entry.reads.add(WILDCARD_PATH);
        const value = computed.get();
        // A lazy first read can move the pre-observation token during render.
        entry.baselineVersion = getComputedSnapshotVersion(computed);

        return value;
    }

    /** Reads one entry of a resource cache and subscribes to that entry alone.
     * A stale entry is not fetched here — the fetch is queued and runs after the commit,
     * by which time the subscription exists.
     *
     * A failure's own notification must not queue another request:
     * explicit invalidation clears `failed` and re-arms even an initial Error entry; a failed
     * refresh keeps Success and its old data until another invalidation or explicit load.
     *
     * @param source - the cache entry's owner; `resolve(...args)` gives the path this render
     * subscribes to, and a stale entry queues a `load` for after the commit
     * @param args - the loader arguments, identifying the entry read now and targeted by the
     * deferred `load`; a different tuple reads a different entry
     */
    public useResource<T, TArgs extends TResourceArgs = []>(
        source: IResourceSource<T, TArgs>,
        ...args: TArgs
    ): TReadonly<IResourceView<T>> {
        const resolution = source.resolve(...args);
        const {path, view, fieldView} = resolution;
        const attempt = this[C.renderAttempt];
        const entry = this[C.track](source);
        (entry.resourcePaths ??= new Set()).add(path);
        // The guard is evaluated per read: a record lands in this render's entry only while
        // the attempt that opened before this call is still the live one and not abandoned.
        const fieldViewRecord = (fieldPath: TPath): void => {
            if (fieldView === undefined || (attempt !== undefined
                && this[C.renderAttempt] === attempt && !attempt.abandoned)) {
                entry.reads.add(fieldPath);
            }
        };
        // The shared reader records the automatic retry dependencies and builds the facade
        // through the source's own fieldView factory, so a custom factory stays authoritative.
        const readerView = resourceReader.view(
            resolution, fieldViewRecord) as unknown as TReadonly<IResourceView<T>>;
        const worthFetching = resourceReader.worthFetching(view);
        // The deferred load belongs to the render attempt that queued it, exactly like the reads
        // do: tentative until the commit that consumes the attempt runs it, discarded with an
        // attempt whose render threw. Every call site runs inside render, where an attempt is
        // always open; outside one there is nothing to attribute the load to, so the view is
        // still returned but the load is skipped — and reported, once per call, in development.
        if (worthFetching) {
            if (attempt) {
                if (attempt.deferredLoads === undefined) {
                    attempt.deferredLoads = [];
                }

                attempt.deferredLoads.push(() => {
                    const ownsAttempt = (): boolean => !attempt.abandoned
                        && this[C.renderAttempt] === undefined && this[C.pendingAttempt] === attempt
                        && this[C.committedAttempt] === attempt;
                    const slot = this[C.tracked]?.get(source);
                    if (!ownsAttempt() || slot?.installed?.carburetor !== source
                        || slot.committed?.carburetor !== source
                        || !slot.committed.resourcePaths?.has(path)) return;
                    const current = source.resolve(...args);
                    if (current.path !== path || !resourceReader.worthFetching(current.view)
                        || !ownsAttempt() || this[C.tracked]?.get(source) !== slot
                        || slot.installed?.carburetor !== source
                        || !slot.committed?.resourcePaths?.has(path)) return;
                    // Preserve custom-source rejection visibility without allocating terminal metadata.
                    if (fieldView === undefined) {
                        void source.load(...args);
                        return;
                    }
                    const loads = slot.resourceLoads ??= new Map();
                    const loading = source.load(...args);
                    if (loads.get(path) === loading) return;
                    if (slot.resourceLoads === loads) loads.set(path, loading);
                    const finish = (superseded: boolean): void => {
                        if (slot.resourceLoads !== loads || loads.get(path) !== loading) return;
                        loads.delete(path);
                        if (this[C.tracked]?.get(source) !== slot || slot.installed?.carburetor !== source
                            || slot.committed?.carburetor !== source
                            || !slot.committed.resourcePaths?.has(path)) return;
                        const settled = source.resolve(...args);
                        if (this[C.tracked]?.get(source) !== slot || slot.resourceLoads !== loads
                            || loads.has(path) || slot.installed?.carburetor !== source
                            || slot.committed?.carburetor !== source
                            || !slot.committed.resourcePaths?.has(path)
                            || settled.path !== path || (superseded
                            && (settled.view.status === EResourceStatus.Pending || settled.view.refreshing))) return;
                        if (resourceReader.rearm(settled.view)
                            || (superseded && settled.present === false
                                && resourceReader.worthFetching(settled.view))) {
                            this.forceUpdate();
                        }
                    };
                    void loading.then(() => finish(false), (error: unknown) => {
                        if (!isCacheSupersededError(error, source, loading)) {
                            if (slot.resourceLoads === loads && loads.get(path) === loading) loads.delete(path);
                            throw error;
                        }
                        finish(true);
                    });
                    // Observe publication at this start, before another queued load can retire it.
                    // An absent custom load has no lifecycle transition to recover; its rejection
                    // remains owned by the terminal handler above, not an automatic retry.
                    const started = source.resolve(...args);
                    const publishedLoading = started.path === path && started.present !== false
                        && (started.view.status === EResourceStatus.Pending || started.view.refreshing);
                    // All starts keep the original absent-default wrapper until the entire
                    // queue has run. Terminal ownership above precedes any adoption failure.
                    return (): void => {
                        const committed = slot.committed;
                        if (!ownsAttempt() || this[C.tracked]?.get(source) !== slot
                            || slot.installed?.carburetor !== source || committed?.carburetor !== source
                            || !committed.resourcePaths?.has(path)
                            || slot.resourceLoads !== loads || loads.get(path) !== loading) return;
                        const adopted = source.resolve(...args);
                        if (adopted.path !== path || !ownsAttempt()
                            || this[C.tracked]?.get(source) !== slot
                            || slot.committed !== committed || slot.installed?.carburetor !== source
                            || !committed.resourcePaths?.has(path)
                            || slot.resourceLoads !== loads || loads.get(path) !== loading) return;
                        // Copy, then close and transfer: never extend a filed closed set.
                        const reads = new Set(committed.reads);
                        resourceReader.collect(adopted, read => { reads.add(read); });
                        const completed = completeReads(reads);
                        if (!sameReads(slot.installed.reads, completed)) {
                            source.subscribe(
                                this[C.onCarburetorUpdate],
                                transferCompletedReads(completed, this[C.uid])
                            );
                            // A source override can reenter while subscribing. Do not publish
                            // this attempt's handle over a newer commit or a released slot.
                            if (!ownsAttempt() || this[C.tracked]?.get(source) !== slot
                                || slot.committed !== committed || slot.installed?.carburetor !== source
                                || slot.resourceLoads !== loads || loads.get(path) !== loading) return;
                            slot.installed = {carburetor: source, reads: completed};
                            committed.reads = completed;
                        }
                        // A later start can abort an already-started loader before adoption.
                        // Filing its Idle status cannot recover the notification already missed;
                        // its ordinary promise still waits for the retired loader's answer.
                        const demand = source.resolve(...args);
                        if (!ownsAttempt() || this[C.tracked]?.get(source) !== slot
                            || slot.committed !== committed || slot.installed?.carburetor !== source
                            || !committed.resourcePaths?.has(path) || demand.path !== path
                            || slot.resourceLoads !== loads || loads.get(path) !== loading) return;
                        if (publishedLoading && demand.view.status !== EResourceStatus.Pending
                            && !demand.view.refreshing && resourceReader.worthFetching(demand.view)) {
                            // Schedule a fresh render/commit, never load recursively here.
                            this.forceUpdate();
                        }
                    };
                });
            } else if (IS_DEVELOPMENT) {
                diagnostics.report(
                    'useResource() skipped the deferred load for entry ' + path +
                    ' because it ran outside a render attempt. That is the only place a deferred ' +
                    'load can be attributed to a commit: run useResource() inside render(), the ' +
                    'way every other read API is meant to run, or refresh the entry from an effect.'
                );
            }
        }

        return readerView;
    }

    /** Subscribes to the entry and to its `data` field, and returns the data, suspending
     * while it loads and rethrowing when it failed — the Suspense read in one call.
     *
     * @param source - the cache entry's owner whose `suspend` serves the visible data.
     * @param args - the loader arguments identifying the entry to read.
     */
    public suspendResource<T, TArgs extends TResourceArgs>(
        source: IResourceSource<T, TArgs> & {suspend(...args: TArgs): T}, ...args: TArgs): T {
        const view = this.useResource(source, ...args);
        void view.data;
        return source.suspend(...args);
    }
    /** Runs the fetches the committed render queued, now that the subscriptions they need
     * exist. Only the pending, un-abandoned, freshly committed attempt has its queue drained.
     *
     * Identity that means exactly "this commit had a fresh render behind it". Anything else is
     * left untouched: an abandoned attempt's queue dies with the attempt, and a commit with no
     * fresh attempt behind it (a StrictMode-replayed mount, a Suspense hide/reveal) has no new
     * render to fetch for. A replayed StrictMode mount cannot double-load: its second
     * `componentDidMount` finds the attempt already consumed (it is the committed attempt, so
     * not the fresh one it drained at the first `componentDidMount`), and the drain above clears
     * the queue before invoking its loads anyway — every queue is consumed exactly once, so the
     * replay finds it absent.
     */
    public [C.loadStaleResources](): void {
        const attempt = this[C.pendingAttempt];

        if (attempt === undefined || attempt.abandoned || attempt !== this[C.committedAttempt]) {
            return;
        }

        // Cleared before the loads run: a load can synchronously notify this component, and
        // the notification path must not find the queue it is draining still in place.
        const queued = attempt.deferredLoads;

        if (queued === undefined) {
            return;
        }

        attempt.deferredLoads = undefined;
        // Adoption follows every start; custom-only loads allocate no adoption queue.
        let adoptions: (() => void)[] | undefined;
        for (const load of queued) {
            const adopt = load();
            if (adopt !== undefined) (adoptions ??= []).push(adopt);
        }
        if (adoptions !== undefined) for (const adopt of adoptions) adopt();
    }

    /** The attempt entry for one source in the current render: created on first use with the
     * source resolved and the baseline version captured, then only its path set grows.
     *
     * Outside a render attempt there is nothing to attribute a read to; a detached entry is
     * returned so the caller still gets data while nothing is recorded or ever published.
     *
     * @param source - the subscription-shaped source to record this render's reads for
     */
    public [C.track](source: ICarburetorSubscription): IAttemptEntry {
        const attempt = this[C.renderAttempt];

        if (!attempt) {
            return {source, baselineVersion: source.getVersion(), reads: new Set<TPath>()};
        }

        let tracked = attempt.tracked;

        if (tracked === undefined) {
            tracked = new Map<ICarburetorSubscription, IAttemptEntry>();
            attempt.tracked = tracked;
        }

        let entry = tracked.get(source);

        if (!entry) {
            entry = {source, baselineVersion: source.getVersion(), reads: new Set<TPath>()};
            tracked.set(source, entry);
        }

        return entry;
    }
}
