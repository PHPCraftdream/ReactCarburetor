import {TReadonly} from "@/Carburetor/Models/Base";
import {TPath} from "@/Carburetor/Models/Paths";
import {IComputed} from "@/Carburetor/Models/Derived";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceSource, IResourceView} from "@/Carburetor/Models/Resource";
import {ICarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {
    IAttemptEntry,
    IConnectionSource,
    IRenderAttempt,
} from "@/Carburetor/Component/Models/Connection";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import {detachSelection} from "@/Carburetor/Component/Connection/detachSelection";
import {reportLiveViewEscape} from "@/Carburetor/Component/Connection/reportLiveViewEscape";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {AntiHookComponentFoundation} from "./Foundation";

const CONNECTION_ATTEMPT_KEY = "c:";
const TRACKED_ATTEMPT_KEY = "t:";
export abstract class AntiHookComponentReads<P = {}, S = {}> extends AntiHookComponentFoundation<P, S> {
    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     *
     * A read is attributed to the render attempt that was open when `useCarburetor` itself
     * ran — and to nothing else: the identity check inside the recorder stops a view captured
     * by an older render and read later (from a handler, an effect) from adding paths to some
     * other attempt's read set.
     */
    public useCarburetor = <T extends object>(carburetor: ICarburetor<T>): TReadonly<T> => {
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);

        return carburetor.read((path: TPath) => {
            if (attempt !== undefined && this.renderAttempt === attempt) {
                entry.reads.add(path);
            }
        });
    };

    /**
     * Declares one connect()-family connection into this component's persistent list and builds
     * its per-attempt source resolver and recorder.
     */
    private declareConnection = <T extends object>(
        source: ICarburetor<T> | (() => ICarburetor<T>)
    ): IConnectionSource<T> =>
        declareConnection(
            this.connections,
            CONNECTION_ATTEMPT_KEY,
            (): IRenderAttempt | undefined => this.renderAttempt,
            source
        );

    /**
     * A persistent view of a carburetor's data, declared once and read directly in render.
     *
     * `useCarburetor` allocates a fresh read-tracking proxy every render — for a component that
     * always reads from the same store this is pure repeated cost. `connect()` instead builds
     * the view once (a class field initializer is the intended call site) and hands back the
     * exact same object for as long as the underlying data object does not change; what changes
     * per render is only what the proxy's recorder collects: a read counts while a render
     * attempt is open — the same boundary `useCarburetor` records under — so a conditional
     * branch reading a different field next render still narrows or widens the subscription.
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
    public connect = <T extends object>(source: ICarburetor<T> | (() => ICarburetor<T>)): TReadonly<T> => {
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);

        // Recorded on the connection itself, not a separate list (R4-05): see IConnection.view.
        declared.connection.view = view;

        return view;
    };

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
     * touches. What the call returns is not that view: plain objects and arrays are
     * shallow-copied, so the child receives detached plain data.
     *
     * The snapshot's identity changes only when the selected content changes — a plain object's
     * own enumerable string and symbol keys are compared for membership plus `Object.is` values,
     * the exact set a shallow spread copies, and an array's length and elements with `Object.is`
     * — and stays the same object otherwise. That is what lets a gated child re-render exactly
     * when the selected data changed, and keep its bail-out otherwise.
     *
     * The selector runs on every call, including every render, because that is what keeps this
     * render's read set — and with it, the subscription the next update needs — fresh; the
     * internal cache is about identity only and never skips a read (a skipped read would drop
     * the connection's dependencies and strand the child).
     *
     * Handing out a live view (the facade or a branch of it) as the snapshot or inside it is
     * not supported and is reported once per selection in development. Select plain values.
     *
     * @param source - the carburetor to read, or a function resolving it at each attempt's
     * first read so a prop swap re-points the connection at the new store
     * @param select - picks the part of the data this child consumes; runs on every call
     */
    public connectSelection = <T extends object, R>(
        source: ICarburetor<T> | (() => ICarburetor<T>),
        select: (data: TReadonly<T>) => R
    ): (() => R) => {
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);

        // Recorded on the connection itself, not a separate list (R4-05): see IConnection.view.
        declared.connection.view = view;

        let snapshot: {value: R} | undefined = undefined;
        let escapeReported = false;

        return (): R => {
            const next: R = select(view);

            if (IS_DEVELOPMENT && !escapeReported) {
                escapeReported = reportLiveViewEscape(next);
            }

            if (snapshot !== undefined && sameSelection(snapshot.value, next)) {
                return snapshot.value;
            }

            snapshot = {value: detachSelection(next) as R};

            return snapshot.value;
        };
    };

    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    public useComputed = <R extends unknown>(computed: IComputed<R>): R => {
        this.track(computed).reads.add(WILDCARD_PATH);

        return computed.get();
    };

    /**
     * Reads one entry of a resource cache, and subscribes to that entry alone.
     *
     * A stale entry is not fetched here: a write during render notifies subscribers mid-render, which
     * is the hazard the rules report. The fetch is queued and runs after the commit, by which time
     * the subscription exists — so the answer reaches this component.
     *
     * An entry that failed is left alone. Retrying it from render would loop: the failure re-renders
     * the component, which would queue the same request again. A failed entry waits for an explicit
     * `refresh`, which is what the documented behaviour promises.
     *
     * The status check alone cannot see every failure: an entry whose *refresh* failed keeps
     * `status: Success` with its old data. `failed` on the view is what stops this method from
     * re-queueing the same failing request from the failure's own notification; only a successful
     * answer, an explicit `refresh`/`load`, or a new `invalidate` re-arms a fetch.
     *
     * @param source - the cache entry's owner: `pathOf(args)` gives the path this render
     * subscribes to, and a stale entry queues a `load` for after the commit
     * @param args - the cache key, identifying the entry read now and targeted by the deferred
     * `load`; a different value reads a different entry
     */
    public useResource = <T extends unknown, TArgs extends unknown>(
        source: IResourceSource<T, TArgs>,
        args: TArgs
    ): IResourceView<T> => {
        this.track(source).reads.add(source.pathOf(args));

        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error && !view.failed;

        // The deferred load belongs to the render attempt that queued it, exactly like the reads
        // do: tentative until the commit that consumes the attempt runs it, discarded with an
        // attempt whose render threw. Every call site runs inside render, where an attempt is
        // always open; outside one there is nothing to attribute the load to, so the view is
        // still returned but the load is skipped — and reported, once per call, in development.
        const attempt = this.renderAttempt;

        if (worthFetching) {
            if (attempt) {
                attempt.deferredLoads.push(() => {
                    void source.load(args);
                });
            } else if (IS_DEVELOPMENT) {
                diagnostics.report(
                    'useResource() skipped the deferred load for entry ' + source.pathOf(args) +
                    ' because it ran outside a render attempt. That is the only place a deferred ' +
                    'load can be attributed to a commit: run useResource() inside render(), the ' +
                    'way every other read API is meant to run, or refresh the entry from an effect.'
                );
            }
        }

        return view;
    };

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
     * the first `componentDidMount`), and the drain above swaps each queue out before invoking
     * its loads anyway — every queue is consumed exactly once, so the replay finds it empty.
     */
    protected loadStaleResources(): void {
        const attempt = this.pendingAttempt;

        if (attempt === undefined || attempt.abandoned || attempt !== this.committedAttempt) {
            return;
        }

        // Swapped out before the loads run: a load can synchronously notify this component, and
        // the notification path must not find the queue it is draining still in place.
        const queued = attempt.deferredLoads;

        attempt.deferredLoads = [];

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
            return {connection: undefined, source, baselineVersion: source.getVersion(), reads: new Set<TPath>()};
        }

        const cuid = source.getUID();
        let entry = attempt.entries.get(TRACKED_ATTEMPT_KEY + cuid);

        if (!entry) {
            entry = {connection: undefined, source, baselineVersion: source.getVersion(), reads: new Set<TPath>()};
            attempt.entries.set(TRACKED_ATTEMPT_KEY + cuid, entry);
        }

        return entry;
    }
}
