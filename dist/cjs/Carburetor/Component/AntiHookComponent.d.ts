import * as React from "react";
import { IDict, TEffect, TEffectCleanup, TEffectDeps, TReadonly } from "../Models/Base.js";
import { IComputed } from "../Models/Derived.js";
import { IResourceSource, IResourceView } from "../Models/Resource.js";
import { TPathSet } from "../Models/Paths.js";
import { ICarburetor, ICarburetorSubscription } from "../Models/Store.js";
/**
 * What one commit established about a dependency: the carburetor a render attempt resolved,
 * the store version when the reading started, and the paths it read.
 *
 * Published only by a commit consuming a fresh render attempt, with the read set copied at
 * that tentative-to-committed transition — so a later read through a stale captured view can
 * never alter what a commit established. The description survives unmount: it is what a
 * StrictMode-replayed mount's commit restores subscriptions from.
 */
interface IDependencyDescription {
    /** The carburetor the attempt resolved and read. */
    carburetor: ICarburetorSubscription;
    /** The store version captured at the attempt's first touch; the commit-time drift check anchors here. */
    baselineVersion: number;
    /** The paths the attempt read; a private copy, never shared with an attempt or a handle. */
    reads: TPathSet;
}
/**
 * The active registration of a dependency: what is actually subscribed in the stores right now.
 *
 * Kept next to the description it was built from so a commit can skip re-registering an
 * unchanged read set, and so a teardown or a re-point at another carburetor knows exactly which
 * store to unsubscribe from. Its lifetime is independent of the description's: unmount and a
 * StrictMode replay clear handles, descriptions stay.
 */
interface ISubscriptionHandle {
    /** The store the registration lives in; unsubscribing goes through it. */
    carburetor: ICarburetorSubscription;
    /** The read set as registered — a copy, so a compare with a fresh description detects drift. */
    reads: TPathSet;
}
/**
 * One component's dependency slot: the two long-lived states a carburetor dependency has.
 *
 * The committed description is data — what the last fresh render attempt read — while the
 * installed handle is a live registration a teardown must release. Keeping them apart is what
 * lets unmount drop a subscription without forgetting what to restore it from.
 */
interface IDependencySlot {
    /** What the last fresh commit established; undefined while nothing current commits to. */
    committed: IDependencyDescription | undefined;
    /** The registration actually in the stores right now; undefined while none is registered. */
    installed: ISubscriptionHandle | undefined;
}
/**
 * A carburetor read through `useCarburetor`, `useComputed` or `useResource`: one dependency
 * slot keyed by the carburetor's own uid.
 *
 * Records are written by commits, out of what a fresh render attempt collected — never by
 * render itself. A commit whose attempt never touched a record releases and deletes it: a
 * store that stops being read must stop being subscribed to, or a write to it re-renders a
 * component that no longer shows that data. What survives unmount is the committed
 * description, which is what a replayed mount restores from.
 */
interface ITrackedCarburetor extends IDependencySlot {
}
/**
 * A `connect()` declaration's bookkeeping: one persistent slot, independent of any one render.
 *
 * A connection is declared once (typically a class field initializer) and lives for the
 * component's whole lifetime — nothing ever deletes it from `connections`, so a branch that
 * stops being read keeps its declaration and can be re-read by a later render. What varies is
 * the slot's content: a fresh attempt publishes a new committed description; a commit whose
 * attempt never touched the connection clears that description, and `alignSubscription` then
 * ends the subscription — an unused connection must have no active read subscription, yet the
 * declaration itself stays ready for a render that reads it again.
 */
interface IConnection extends IDependencySlot {
    /** This connection's own id — stable across whatever carburetor it points at right now. */
    uid: string;
    /**
     * Resolves the carburetor to read; an attempt's first read resolves it once for the whole
     * attempt, so a prop swap is noticed by the next render, not re-probed per field.
     */
    getCarburetor: () => ICarburetorSubscription;
}
/**
 * One source's read record inside one render attempt: tentative, and never merged across
 * attempts.
 *
 * The source and its baseline version are captured once, at the first read of the attempt —
 * not refreshed after every property access — so a write landing mid-render or mid-commit
 * stays detectable at commit time. Later reads in the same attempt only grow the path set.
 */
interface IAttemptEntry {
    /** Set for a connection read: where a commit publishes the description built from this entry. */
    connection: IConnection | undefined;
    /** The carburetor the read resolved to, captured at the attempt's first touch. */
    source: ICarburetorSubscription;
    /** The store version at that first touch; the commit-time drift check anchors here. */
    baselineVersion: number;
    /** The paths read during this attempt; grows monotonically until the attempt closes. */
    reads: TPathSet;
}
/**
 * One render attempt's collection: the boundary between render and everything else.
 *
 * Opened immediately before the subclass's render runs and closed in a `finally` right after
 * it returns or throws, it is the only thing the read recorders write to. Nothing is open
 * during the render→commit gap, so child mount callbacks, sibling renders, effects and
 * handlers reading a captured view cannot alter this render's dependency set or version
 * evidence. An abandoned attempt (its render threw) is never consumed by a commit.
 */
interface IRenderAttempt {
    /** Collected entries, keyed by `CONNECTION_ATTEMPT_KEY`/`TRACKED_ATTEMPT_KEY` + source uid. */
    entries: Map<string, IAttemptEntry>;
    /**
     * Sources already resolved during this attempt, keyed like `entries`. The per-attempt memo
     * behind a connection's resolution: view resolution and the recorder's baseline capture
     * share it, so reading several fields resolves the source once per attempt instead of once
     * per field. It dies with the attempt, so no source selection survives into a later render.
     */
    sources: Map<string, ICarburetorSubscription>;
    /** True when the render threw — an error or a Suspense thenable; a commit will not consume it. */
    abandoned: boolean;
}
/** Per-effect bookkeeping: what the effect last ran with, and the cleanup it returned. */
interface IEffectRecord {
    /** The deps the effect last ran with; compared shallowly to skip a redundant run. */
    deps: TEffectDeps;
    /** What the effect returned, if that was a function; run before the next run and on unmount. */
    cleanup: TEffectCleanup | undefined;
}
/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount or
 * shouldComponentUpdate. If you do override those, call the super implementation — otherwise
 * effects, subscription cleanup or the props gate will not work.
 */
export declare class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string;
    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<IEffectRecord>;
    /**
     * Carburetors read through `useCarburetor`/`useComputed`/`useResource`: one dependency slot
     * per carburetor, written by commits out of what a fresh render attempt collected.
     *
     * The committed descriptions outlive unmount: releaseSubscriptions keeps them, so a
     * replayed mount lifecycle can restore the subscriptions without a render to refill them.
     * The records themselves do not: a commit whose attempt never touched a record drops it.
     */
    protected tracked: IDict<ITrackedCarburetor>;
    /**
     * Persistent `connect()` declarations, in declaration order.
     *
     * Never pruned: a connection lives from the field initializer that created it until the
     * component itself is torn down, unlike `tracked`, which `commitSubscriptions` drops the
     * moment a render stops touching it. What a commit clears on an untouched connection is
     * its committed description — ending the subscription; the declaration stays reusable.
     */
    protected connections: IConnection[];
    /** The render attempt currently open, if any; recorders write only while this is set. */
    protected renderAttempt: IRenderAttempt | undefined;
    /** The last closed attempt, waiting for the commit that may consume it. */
    protected pendingAttempt: IRenderAttempt | undefined;
    /**
     * The attempt the last commit consumed: identity, not a counter, says whether this commit
     * has a new render behind it.
     */
    protected committedAttempt: IRenderAttempt | undefined;
    /** Stale entries this render found. Fetched after the commit — never during render. */
    protected staleResources: (() => void)[];
    /**
     * Hands React a boundary proxy instead of the instance, so every later read or definition
     * of `render` goes through its traps and the render-attempt boundary is installed at the
     * moment the render first exists.
     *
     * Returning an object from a derived constructor replaces `this` for the rest of
     * construction, which is what makes definition-time wrapping possible: a subclass's
     * class-field initializers then run against the proxy, and a class-field `render` is
     * defined through its `defineProperty` trap. Neither alternative can do that. A prototype
     * accessor cannot: class fields are installed with `Object.defineProperty` semantics,
     * which replaces an inherited accessor instead of calling it. And no React lifecycle hook
     * can: React never calls a mount hook for a component that defines
     * `getDerivedStateFromProps` or `getSnapshotBeforeUpdate`, so a fallback installed there
     * silently never runs for exactly those components.
     *
     * @param props - forwarded to `React.Component` untouched
     */
    constructor(props: Readonly<P>);
    /**
     * A re-render of the parent must not cascade down the tree. Precise invalidation only
     * governs updates coming from a carburetor; without this gate every parent render would
     * re-render every descendant, which is the very cost the engine exists to avoid.
     *
     * This is safe here because a component does not depend on its parent to learn about
     * state: when its own data changes it re-renders itself through forceUpdate, which
     * bypasses shouldComponentUpdate.
     *
     * @param nextProps - the incoming props, shallow-compared against the current ones; an object
     * or arrow rebuilt by the parent still counts as changed and lets the update through
     * @param nextState - the incoming state, compared with shallowEqual the same way; updates a
     * carburetor triggers never depend on this gate, since forceUpdate bypasses it
     */
    shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean;
    /** Establishes the subscriptions this render collected, then fetches and runs effects. */
    componentDidMount(): void;
    /** The same commit work as on mount, with the previous props' effects torn down first. */
    componentDidUpdate(prevProps: Readonly<P>): void;
    /** Releases everything this component holds: effect cleanups first, subscriptions last. */
    componentWillUnmount(): void;
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
    useCarburetor: <T extends object>(carburetor: ICarburetor<T>) => TReadonly<T>;
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
    connect: <T extends object>(source: ICarburetor<T> | (() => ICarburetor<T>)) => TReadonly<T>;
    /**
     * Builds the persistent view one connect()-family declaration reads through: the once-only
     * shape probe, the declared-kind assertion, the forwarding facade.
     *
     * Shared by `connect` and `connectSelection`, which declare one connection, record through
     * one recorder, and hand out one facade whose object/array kind is fixed at declaration
     * time — the JS-03 contract, see `connect`'s docstring.
     *
     * @param getCarburetor - resolves the carburetor to read; called at an attempt's first read
     * (and once here, probing the root's shape), so a prop swap is noticed
     * @param recorder - where each read path is reported while a render attempt is open
     * @param resolveAttemptSource - resolves the source through the attempt's once-per-attempt
     * memo, so view resolution and the recorder's baseline capture share one resolution; an
     * uncached resolution outside any attempt
     */
    private buildPersistentView;
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
     * The snapshot's identity changes only when the selected content changes — members are
     * compared with `Object.is`, one level deep, the same comparison a props gate applies —
     * and stays the same object otherwise. That is what lets a gated child re-render exactly
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
    connectSelection: <T extends object, R>(source: ICarburetor<T> | (() => ICarburetor<T>), select: (data: TReadonly<T>) => R) => (() => R);
    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    useComputed: <R extends unknown>(computed: IComputed<R>) => R;
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
    useResource: <T extends unknown, TArgs extends unknown>(source: IResourceSource<T, TArgs>, args: TArgs) => IResourceView<T>;
    /** Runs the fetches render queued, now that the subscriptions they need exist. */
    protected loadStaleResources(): void;
    /**
     * Wraps this instance in the render boundary proxy; the constructor hands the proxy to
     * React in place of `this`.
     *
     * Only `render` is special-cased — every other property forwards to the target untouched,
     * so the instance keeps its ordinary shape: own keys, property descriptors and the
     * prototype chain are the target's own. The raw render and the boundary built for it live
     * in this closure, so a boundary is built exactly once per raw render per instance.
     */
    private withRenderBoundary;
    /**
     * Builds the boundary around one raw render: opens a render attempt before it runs, marks
     * the attempt abandoned when the render throws (an error, or a Suspense thenable), and
     * closes it right after — a commit never consumes what an abandoned render collected.
     *
     * @param realRender - the subclass's own render, called with the raw instance as `this`
     */
    private buildRenderBoundary;
    /**
     * Opens a fresh render attempt: an empty entry map this render's reads will fill.
     *
     * Any previous tentative state is discarded by replacement — it simply stops being
     * reachable — so an abandoned collection can never bleed into a new attempt.
     */
    private openRenderAttempt;
    /**
     * Closes a render attempt: it becomes the candidate the next commit may consume.
     *
     * From here until the next open there is no current attempt, so nothing records: the
     * render→commit gap is inert, and reads through captured views — from handlers, effects or
     * other components' callbacks — cannot alter this render's dependency set.
     *
     * @param attempt - the attempt just closed; kept as pending even when the render threw
     */
    private closeRenderAttempt;
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
    /**
     * Where a subclass declares its effects; called after every commit.
     */
    protected useEffects(): void;
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void;
    /**
     * Runs `callBack` when its dependencies changed since the last run.
     *
     * Whatever the effect returns is treated as its cleanup and is run before the effect runs
     * again, and on unmount — so setup and teardown stay paired per effect rather than being
     * one global hook for the whole component.
     *
     * @param callBack - the effect body; a function it returns becomes the cleanup, run before
     * the next run and on unmount
     * @param name - the key in the per-effect record, so two effects sharing one name would
     * overwrite each other's deps and cleanup
     * @param deps - compared shallowly with the last run's; an equal set skips the run and
     * leaves the existing cleanup standing
     */
    protected useEffect: (callBack: TEffect, name: string, deps: TEffectDeps) => void;
    /** Runs every effect's cleanup once, on unmount, and forgets them. */
    protected releaseEffects(): void;
    /**
     * What a carburetor calls when a path this component read was written.
     *
     * `forceUpdate` deliberately skips `shouldComponentUpdate`: the props gate must not be able
     * to swallow an update the component is itself subscribed to.
     */
    protected onCarburetorUpdate: () => void;
    /**
     * Establishes this commit's subscriptions and drops the ones this render no longer needs.
     *
     * A commit consumes the pending render attempt exactly once, and only a fresh one: a fresh
     * attempt's entries become each dependency's committed description — the read set copied —
     * records the attempt never touched are released and deleted, and a connection it never
     * touched loses its description, which `alignSubscription` turns into an unsubscribe. A
     * commit with no fresh attempt behind it (a StrictMode-replayed mount, a Suspense
     * hide/reveal) skips all of that and only re-aligns, restoring subscriptions from the
     * descriptions the last fresh commit published.
     *
     * Subscribing happens here rather than in render: render has to stay pure, otherwise an
     * abandoned concurrent render would leave subscriptions pointing at a component that was
     * never committed. The price is the window between render and commit, which stays closed
     * because every description carries the baseline version its attempt captured at first
     * read — a write landing in the gap is still detected, and force-updated away.
     */
    protected commitSubscriptions(): void;
    /**
     * Brings one slot's registration in line with its committed description.
     *
     * No description means nothing may be listening: an installed handle is unsubscribed and
     * cleared. Otherwise a handle pointing at another carburetor is dropped first, and an
     * unchanged read set skips re-registering. Returns the drift check: whether the store's
     * version moved past the description's baseline, i.e. whether a write landed between the
     * render's read and this commit — anchored to the baseline captured at the attempt's first
     * read, not refreshed after every access, which is what keeps an unused connection from
     * looping forceUpdate forever.
     *
     * @param uid - the id the slot's registration is keyed under: the component's own for
     * `tracked` records, the connection's own for connections
     * @param slot - the slot to align
     */
    private alignSubscription;
    /**
     * Ends a slot's active registration, leaving its committed description untouched.
     *
     * Serves both callers that want exactly that: teardown (clear every handle, keep every
     * description for a replayed mount's restore) and a fresh commit's prune pass (delete
     * whole records, but empty their stores first).
     *
     * @param uid - the id the slot's registration is keyed under: the component's own for
     * `tracked` records, the connection's own for connections
     * @param slot - the slot whose handle to clear
     */
    private releaseSlot;
    /**
     * Unsubscribes from every source, so a carburetor stops holding this instance.
     *
     * Only the active handles go: every committed description stays, as do the pending and
     * consumed attempt identities. That is exactly what lets a StrictMode-replayed mount's
     * commit re-install the subscriptions without a new render — its attempt is not fresh, so
     * `alignSubscription` reinstalls from the descriptions the last fresh commit published —
     * and what keeps the replay from being mistaken for an empty render, which would drop
     * every dependency as unread. A render still drops what it stops reading: that runs
     * through a fresh attempt, which clears descriptions wholesale, not through this method.
     */
    protected releaseSubscriptions(): void;
}
export {};
