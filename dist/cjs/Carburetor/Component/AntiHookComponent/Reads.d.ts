import { TReadonly } from "../../Models/Base.js";
import { IComputed } from "../../Models/Derived.js";
import { IResourceSource, IResourceView } from "../../Models/Resource.js";
import { ICarburetor, ICarburetorSubscription } from "../../Models/Store.js";
import { IAttemptEntry } from "../Models/Connection.js";
import { AntiHookComponentFoundation } from "./Foundation.js";
export declare abstract class AntiHookComponentReads<P = {}, S = {}> extends AntiHookComponentFoundation<P, S> {
    /** `useCarburetor`'s per-carburetor root views, created on first use; see buildTrackedView. */
    private trackedViews;
    /** Live accessor for the recorder built into a cached view, whose call site is long gone. */
    private readonly getRenderAttempt;
    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     *
     * The view is the same object across renders while the carburetor and its data object stay
     * the same; `setData`/`restore` rebuild it. Reads outside the attempt that last called this
     * method record nothing.
     */
    useCarburetor<T extends object>(carburetor: ICarburetor<T>): TReadonly<T>;
    /**
     * Declares one connect()-family connection into this component's persistent list and builds
     * its per-attempt source resolver and recorder.
     */
    private declareConnection;
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
    connect<T extends object>(source: ICarburetor<T> | (() => ICarburetor<T>)): TReadonly<T>;
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
     * touches. Plain objects and arrays are copied recursively with their own data descriptors;
     * ordinary Map/Set/Date values are detached too, preserving aliases within the snapshot.
     *
     * The snapshot is reused while selected plain content, descriptors, prototypes and
     * reference-sharing topology match. Mutable exotic members conservatively count as changed;
     * project them into plain data when a gated child needs precise memoization.
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
    connectSelection<T extends object, R>(source: ICarburetor<T> | (() => ICarburetor<T>), select: (data: TReadonly<T>) => R): (() => R);
    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    useComputed<R extends unknown>(computed: IComputed<R>): R;
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
    useResource<T extends unknown, TArgs extends unknown>(source: IResourceSource<T, TArgs>, args: TArgs): IResourceView<T>;
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
    protected loadStaleResources(): void;
    /**
     * The attempt entry for one source in the current render: created on first use with the
     * source resolved and the baseline version captured, then only its path set grows.
     *
     * Outside a render attempt there is nothing to attribute a read to; a detached entry is
     * returned so the caller still gets data while nothing is recorded or ever published.
     *
     * @param source - the subscription-shaped source to record this render's reads for
     */
    protected track(source: ICarburetorSubscription): IAttemptEntry;
}
