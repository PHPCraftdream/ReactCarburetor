import { TReadonly } from "../../Models/Base.mjs";
import { ICarburetor, ICarburetorSubscription } from "../../Models/Store.mjs";
import { TPathRecorder, TPathSet } from "../../Models/Paths.mjs";
/**
 * What one commit established about a dependency: the carburetor a render attempt resolved,
 * the store version when the reading started, and the paths it read.
 *
 * Published only by a commit consuming a fresh render attempt, with the read set copied at
 * that tentative-to-committed transition — so a later read through a stale captured view can
 * never alter what a commit established. The description survives unmount: it is what a
 * StrictMode-replayed mount's commit restores subscriptions from.
 */
export interface IDependencyDescription {
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
export interface ISubscriptionHandle {
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
export interface IDependencySlot {
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
export interface ITrackedCarburetor extends IDependencySlot {
}
/** `useCarburetor`'s persistent root view for one carburetor; see buildTrackedView. */
export interface ITrackedView<T extends object> {
    /** The data object this view was built for; a different object triggers a rebuild. */
    data: T;
    /** The read proxy itself, built once and reused for as long as `data` stays current. */
    view: TReadonly<T>;
    /** The render attempt captured at the most recent `useCarburetor()` call for this carburetor. */
    attempt: IRenderAttempt | undefined;
    /** That attempt's tracked entry, paired with `attempt`: where the recorder reports paths. */
    entry: IAttemptEntry | undefined;
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
export interface IConnection extends IDependencySlot {
    /** This connection's own id — stable across whatever carburetor it points at right now. */
    uid: string;
    /**
     * Resolves the carburetor to read; an attempt's first read resolves it once for the whole
     * attempt, so a prop swap is noticed by the next render, not re-probed per field.
     */
    getCarburetor: () => ICarburetorSubscription;
    /**
     * The attempt this connection's `attemptSource`/`attemptEntry` were captured for; R16-09
     * moved both off a per-render `Map` and onto the connection itself so a render touching a
     * connection allocates neither. A mismatch against the attempt currently open means both are
     * stale and must be rebuilt before use — see `declareConnection`'s `tagAttempt`.
     */
    attemptTag: IRenderAttempt | undefined;
    /** The source `resolveAttemptSource` resolved for `attemptTag`; stale once the tag mismatches. */
    attemptSource: ICarburetorSubscription | undefined;
    /**
     * This connection's read record for `attemptTag`, created on the first path a render
     * actually reads through it — resolving the source alone does not set this, matching the
     * old `attempt.connections` map, which only ever gained an entry from a recorded read.
     */
    attemptEntry: IAttemptEntry | undefined;
}
/**
 * One source's read record inside one render attempt: tentative, and never merged across
 * attempts.
 *
 * The source and its baseline version are captured once, at the first read of the attempt —
 * not refreshed after every property access — so a write landing mid-render or mid-commit
 * stays detectable at commit time. Later reads in the same attempt only grow the path set.
 * Which of the attempt's two maps holds an entry already says whether it is a connection's or
 * a tracked carburetor's, so the entry itself does not need to say so.
 */
export interface IAttemptEntry {
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
 *
 * Every collection here starts absent and is allocated by whichever read API first needs it: a
 * render that never calls `connect()`/`connectSelection()` or `useResource()` never allocates
 * `connections` or `deferredLoads`, and one that reads nothing at all allocates none of them.
 * `commitSubscriptions` treats an absent collection exactly like an empty one.
 */
export interface IRenderAttempt {
    /** `useCarburetor`/`useComputed`/`useResource` entries, keyed by the source read. */
    tracked: Map<ICarburetorSubscription, IAttemptEntry> | undefined;
    /**
     * `connect()`-family connections this attempt actually read a path through, in touch order.
     * R16-09: the entry each one collected lives on the connection itself (`attemptEntry`),
     * tagged with this attempt, so this array only has to say which connections to look at —
     * not carry a second copy of what they collected.
     */
    connections: IConnection[] | undefined;
    /**
     * The fetches this render queued: tentative like everything else the attempt collected,
     * becoming real only if a commit consumes this attempt. An abandoned attempt's queue dies
     * with the attempt, so a render that never committed cannot leave network work behind for a
     * later commit on the same instance to run.
     */
    deferredLoads: (() => void)[] | undefined;
    /** True when the render threw — an error or a Suspense thenable; a commit will not consume it. */
    abandoned: boolean;
}
/**
 * What one connect()-family declaration hands its owner: the registered connection, the
 * resolver/recorder the persistent view is built on, and the facade's own mutable state.
 *
 * One object serves both declareConnection's bookkeeping and the facade cache:
 * `ConnectionFacadeHandler` reads and writes this instance instead of holding a second copy.
 */
export interface IConnectionSource<T extends object> {
    /** The connection this declaration registered. */
    connection: IConnection;
    /** The carburetor resolver the declaration was created with, normalized to a function. */
    getCarburetor: () => ICarburetor<T>;
    /** Resolves the source through the current attempt's once-per-attempt memo. */
    resolveAttemptSource: () => ICarburetor<T>;
    /** The read recorder every read through the persistent view reports to. */
    recorder: TPathRecorder;
    /**
     * Whether the facade is array-shaped; fixed once by buildPersistentView's declaration-time
     * probe and never changed afterward — a Proxy's target kind cannot change after creation.
     */
    arrayFacade: boolean;
    /**
     * The shape probe's own error, when reading the source at declaration time threw — kept so
     * it can be attached as a later kind-mismatch's cause instead of being discarded.
     */
    probeError: unknown;
    /** The data object the persistent view was last built for; a different object rebuilds it. */
    cachedTarget: T | undefined;
    /** The persistent view built over `cachedTarget`; reused while `cachedTarget` stays current. */
    cachedView: TReadonly<T> | undefined;
}
