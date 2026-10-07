"use client";

import {TReadonly} from "@/Carburetor/Models/Base";
import {TPath} from "@/Carburetor/Models/Paths";
import {completeReads} from "@/Carburetor/Store/Tracking/Observation/completeReads";
import {sameReads} from "@/Carburetor/Store/Tracking/Observation/sameReads";
import {IComputed} from "@/Carburetor/Models/Derived";
import {getComputedSnapshotVersion} from "@/Carburetor/Derived/Freshness/getComputedSnapshotVersion";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceSource, IResourceView} from "@/Carburetor/Models/Resource";
import {IReadableCarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {
    IAttemptEntry,
    IConnection,
    IConnectionSource,
    IRenderAttempt,
    ITrackedView,
} from "@/Carburetor/Component/Models/Connection";
import {buildTrackedView} from "@/Carburetor/Component/AntiHookComponent/buildTrackedView";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import {reportLiveViewEscape} from "@/Carburetor/Component/Connection/reportLiveViewEscape";
import {reuseSelection} from "@/Carburetor/Store/Utils/Selection/Patch/reuseSelection";
import {reconcileSelection} from "@/Carburetor/Store/Utils/Selection/reconcileSelection";
import {reconcileFlatSelection} from "@/Carburetor/Store/Utils/Selection/reconcileFlatSelection";
import {rejectArraySubclass} from "@/Carburetor/Store/Utils/Selection/rejectArraySubclass";
import {TCompletedReads} from "@/Carburetor/Store/Tracking/Observation/Models";
import {AntiHookComponentFoundation} from "./Foundation";

export abstract class AntiHookComponentReads<P = {}, S = {}> extends AntiHookComponentFoundation<P, S> {
    /**
     * Resolved via the prototype chain on `AntiHookComponentSubscriptions`, the fragment that
     * owns connection re-filing; declared here because the equal-value wake path below calls it.
     */
    protected abstract migrateConnectionReads(connection: IConnection, reads: TCompletedReads, version: number): void;

    /** `useCarburetor`'s per-carburetor root views, created on first use; see buildTrackedView. */
    private trackedViews: WeakMap<ICarburetorSubscription, ITrackedView<object>> | undefined;

    /** Live accessor for the recorder built into a cached view, whose call site is long gone. */
    private readonly getRenderAttempt = (): IRenderAttempt | undefined => this.renderAttempt;

    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     *
     * The view is the same object across renders while the carburetor and its data object stay
     * the same; `setData`/`restore` rebuild it. Reads outside the attempt that last called this
     * method record nothing.
     */
    public useCarburetor<T extends object>(carburetor: IReadableCarburetor<T>): TReadonly<T> {
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);

        if (this.trackedViews === undefined) {
            this.trackedViews = new WeakMap();
        }

        return buildTrackedView(this.trackedViews, carburetor, this.getRenderAttempt, attempt, entry);
    }

    /**
     * Declares one connect()-family connection into this component's persistent list and builds
     * its per-attempt source resolver and recorder.
     */
    private declareConnection<T extends object>(
        source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>)
    ): IConnectionSource<T> {
        return declareConnection(this.connections, this.getRenderAttempt, source);
    }

    /**
     * A persistent view of a carburetor's data, declared once and read directly in render.
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
        const declared = this.declareConnection(source);

        return buildPersistentView(declared);
    }

    /**
     * A typed selection of this component's connected data, safe to hand a child gated by
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
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);

        let snapshot: {value: R} | undefined = undefined;
        let escapeReported = false;
        // What the snapshot mirrors, for R36-01's reuse: the live result, its ledger, and whether it is a tree.
        let live: unknown = undefined;
        let ledger: WeakMap<object, unknown> | undefined;
        let patchable = false;

        // R36-02: a write to a path the selection read wakes this connection, not the owner. The
        // selector re-runs here, outside any render attempt, against the committed props and state;
        // the owner re-renders only when the snapshot moves; equal snapshots migrate closed reads.
        // A render in flight, a throw or no committed description takes the plain re-render.
        const connection = declared.connection;
        const selectionUnchanged = (): boolean => {
            const committed = connection.committed;

            if (snapshot === undefined || committed === undefined || this.renderAttempt !== undefined) {
                return false;
            }

            const version = committed.carburetor.getVersion();
            const scratch = new Set<TPath>();
            let unchanged = false;

            declared.scratch = scratch;

            try {
                const next = select(view);

                // The same live view with a write under it has changed: no walk needed to say so.
                unchanged = !(next === live && next !== null && typeof next === 'object') &&
                    reconcileSelection(snapshot.value, next, undefined, rejectArraySubclass) === snapshot.value;
            } catch {
                unchanged = false;
            } finally {
                declared.scratch = undefined;
            }

            if (!unchanged) {
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

            this.migrateConnectionReads(connection, reads, version);

            return true;
        };

        connection.wake = (): void => {
            if (!selectionUnchanged()) {
                this.forceUpdate();
            }
        };

        return (): TReadonly<R> => {
            const next: R = select(view);

            const previous = snapshot === undefined ? undefined : snapshot.value;

            // R36-01: the same live view as last render: no related write keeps the snapshot as is,
            // a related one is patched from the write log, and the filed read set is adopted.
            if (previous !== undefined && next === live && next !== null && typeof next === 'object'
                && ledger !== undefined) {
                const reused = reuseSelection(connection, previous, next, ledger, patchable);

                if (reused !== undefined) {
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

            snapshot = {
                value: flat !== undefined ? flat.value as R : reconcileSelection(
                    previous, next, undefined, rejectArraySubclass, previous === undefined ? undefined : ledger,
                    nextLedger, trace
                ) as R,
            };
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
        const entry = this.track(computed);
        entry.reads.add(WILDCARD_PATH);
        const value = computed.get();
        // A lazy first read can move the pre-observation token during render.
        entry.baselineVersion = getComputedSnapshotVersion(computed);

        return value;
    }

    /**
     * Reads one entry of a resource cache, and subscribes to that entry alone.
     *
     * A stale entry is not fetched here: a write during render notifies subscribers mid-render, which
     * is the hazard the rules report. The fetch is queued and runs after the commit, by which time
     * the subscription exists — so the answer reaches this component.
     *
     * A failure's own notification must not queue another request. Explicit invalidation
     * clears `failed` and re-arms even an initial Error entry; the retry still starts only
     * after the reader's next commit. A failed refresh keeps Success and its old data, with
     * `failed` preventing an automatic retry until another invalidation or explicit load.
     *
     * @param source - the cache entry's owner: `resolve(args)` gives the path this render
     * subscribes to, and a stale entry queues a `load` for after the commit
     * @param args - the cache key, identifying the entry read now and targeted by the deferred
     * `load`; a different value reads a different entry
     */
    public useResource<T extends unknown, TArgs extends unknown>(
        source: IResourceSource<T, TArgs>,
        args: TArgs
    ): IResourceView<T> {
        // One call: resolve() serializes args once and hands back the key, the read path and
        // the current view together (R16-10(4)), where this used to be three separate calls.
        const {path, view} = source.resolve(args);

        this.track(source).reads.add(path);

        const worthFetching = view.stale && !view.refreshing && !view.failed
            && (view.status !== EResourceStatus.Error || view.invalidated);

        // The deferred load belongs to the render attempt that queued it, exactly like the reads
        // do: tentative until the commit that consumes the attempt runs it, discarded with an
        // attempt whose render threw. Every call site runs inside render, where an attempt is
        // always open; outside one there is nothing to attribute the load to, so the view is
        // still returned but the load is skipped — and reported, once per call, in development.
        const attempt = this.renderAttempt;

        if (worthFetching) {
            if (attempt) {
                if (attempt.deferredLoads === undefined) {
                    attempt.deferredLoads = [];
                }

                attempt.deferredLoads.push(() => {
                    void source.load(args);
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

        return view;
    }

    /**
     * Runs the fetches the committed render queued, now that the subscriptions they need exist.
     *
     * Only the attempt this commit consumed has its queue drained: it must be the pending
     * attempt, un-abandoned, and the very attempt `commitSubscriptions` published — identity
     * that means exactly "this commit had a fresh render behind it". Anything else is left
     * untouched: an abandoned attempt's queue dies with the attempt, and a commit with no fresh
     * attempt behind it (a StrictMode-replayed mount, a Suspense hide/reveal) has no new render
     * to fetch for.
     *
     * A replayed StrictMode mount cannot double-load: its second `componentDidMount` finds the
     * attempt already consumed (it is the committed attempt, so not the fresh one it drained at
     * the first `componentDidMount`), and the drain above clears the queue before invoking its
     * loads anyway — every queue is consumed exactly once, so the replay finds it absent.
     */
    protected loadStaleResources(): void {
        const attempt = this.pendingAttempt;

        if (attempt === undefined || attempt.abandoned || attempt !== this.committedAttempt) {
            return;
        }

        // Cleared before the loads run: a load can synchronously notify this component, and
        // the notification path must not find the queue it is draining still in place.
        const queued = attempt.deferredLoads;

        if (queued === undefined) {
            return;
        }

        attempt.deferredLoads = undefined;

        queued.forEach((load: () => void) => load());
    }

    /**
     * The attempt entry for one source in the current render: created on first use with the
     * source resolved and the baseline version captured, then only its path set grows.
     *
     * Outside a render attempt there is nothing to attribute a read to; a detached entry is
     * returned so the caller still gets data while nothing is recorded or ever published.
     *
     * @param source - the subscription-shaped source to record this render's reads for
     */
    protected track(source: ICarburetorSubscription): IAttemptEntry {
        const attempt = this.renderAttempt;

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
