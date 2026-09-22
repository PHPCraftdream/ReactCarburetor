import * as React from "react";
import {IDict, TEffect, TEffectCleanup, TEffectDeps, TReadonly} from "@/Carburetor/Models/Base";
import {IComputed} from "@/Carburetor/Models/Derived";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceSource, IResourceView} from "@/Carburetor/Models/Resource";
import {TPath, TPathRecorder, TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {shallowEqual} from "./shallowEqual";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

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
interface ITrackedCarburetor extends IDependencySlot {}

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
    /**
     * The fetches this render queued: tentative like everything else the attempt collected,
     * becoming real only if a commit consumes this attempt. An abandoned attempt's queue dies
     * with the attempt, so a render that never committed cannot leave network work behind for a
     * later commit on the same instance to run.
     */
    deferredLoads: (() => void)[];
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
 * Membership equality for path sets: same size, every member present — the identity of the
 * Set plays no role.
 */
const sameReads = (a: TPathSet, b: TPathSet): boolean => {
    if (a.size !== b.size) {
        return false;
    }

    for (const path of a) {
        if (!b.has(path)) {
            return false;
        }
    }

    return true;
};

/**
 * What a failure reads as in a dev-only report: the message when it has one, `String()` when
 * it does not — the same conversion the store's delivery paths use for their reports.
 */
const describeFailure = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error));

/**
 * Whether `value` is a plain object: a non-null, non-array object whose prototype is
 * `Object.prototype` or `null` — the shape a detached selection's members take, and the only
 * shape the selection comparison below knows how to look inside.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype: object | null = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
};

/**
 * The own enumerable property keys of `value` — strings and symbols alike — in the order
 * `Reflect.ownKeys` reports them.
 *
 * This is the one set the selection comparison and the detachment agree on: a shallow spread
 * (`{...value}`) copies exactly these keys and nothing else, so comparing them is comparing
 * what a child can actually see.
 */
const ownEnumerableKeys = (value: object): Array<string | symbol> =>
    Reflect.ownKeys(value).filter((key: string | symbol): boolean =>
        Object.prototype.propertyIsEnumerable.call(value, key));

/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * A plain object compares its own enumerable string and symbol keys — the exact set a shallow
 * spread copies — for membership plus `Object.is` values, and an array compares its length and
 * elements with `Object.is`, the exact set `Array.from` copies. The detached previous snapshot
 * is compared against the raw fresh selection: a shallow copy shares every member with its
 * source, so identity differences introduced by detaching say nothing about content.
 */
const sameSelection = (snapshot: unknown, next: unknown): boolean => {
    if (Object.is(snapshot, next)) {
        return true;
    }

    const snapshotIsArray = Array.isArray(snapshot);
    const nextIsArray = Array.isArray(next);

    if (snapshotIsArray || nextIsArray) {
        if (!snapshotIsArray || !nextIsArray) {
            return false;
        }

        // Deliberate asymmetry with the plain-object branch below: `Array.from` copies indices
        // and nothing else — no extra own properties, no symbol keys — so element-wise Object.is
        // already covers the whole copied set of an array.

        // Bindings narrowed ahead of the callback: a `.every` body runs outside the guards'
        // narrowing reach.
        const previousMembers = snapshot as unknown[];
        const freshMembers = next as unknown[];

        return previousMembers.length === freshMembers.length &&
            previousMembers.every((member: unknown, index: number): boolean =>
                Object.is(member, freshMembers[index]));
    }

    if (!isPlainObject(snapshot) || !isPlainObject(next)) {
        return false;
    }

    const previousKeys = ownEnumerableKeys(snapshot);
    const freshKeys = ownEnumerableKeys(next);

    if (previousKeys.length !== freshKeys.length) {
        return false;
    }

    // Bindings narrowed ahead of the callback: a `.every` body runs outside the guards'
    // narrowing reach.
    const previousMembers = snapshot as Record<string | symbol, unknown>;
    const freshMembers = next as Record<string | symbol, unknown>;

    // Equal cardinality plus every previous key present on the fresh object leaves the two key
    // sets no room to differ, so a key swapped for another one — `{a: undefined}` becoming
    // `{b: undefined}`, say — is a content change even though the counts match.
    return previousKeys.every((key: string | symbol): boolean =>
        Object.prototype.hasOwnProperty.call(freshMembers, key) &&
        Object.is(previousMembers[key], freshMembers[key]));
};

/**
 * The detached form of a selection's value — the form safe to hand a child.
 *
 * Plain objects and arrays are shallow-copied, so a child receives plain data that outlives
 * the render instead of a branch of the live view; a branch read inside the child's own render
 * would record nothing and sit under no subscription. Primitives are detached by being values.
 * Exotic objects (Map, Date, class instances) would lose their prototype to a copy, so they
 * pass as is. The copy is also what the comparison reads: the copied key set and the compared
 * key set agree by construction, which is what makes a stable snapshot mean a stable view.
 */
const detachSelection = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return Array.from(value);
    }

    if (isPlainObject(value)) {
        return {...value};
    }

    return value;
};

/**
 * The development diagnostic for a selection that hands a live view to a child.
 *
 * Reported once per selection, not per render — the mistake is the declaration's, and one
 * complaint names it. Returns whether a report was made, so the caller latches only on a real
 * escape and a selection that only later starts handing out a live view is still caught;
 * production compiles the call site out, leaving behavior unchanged.
 *
 * @param next - the fresh selection to inspect: its whole value first, then its members one
 * level deep
 */
const reportLiveViewEscape = (next: unknown): boolean => {
    const guidance = 'A child reading it in its own render records nothing, so no subscription covers what it ' +
        'sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays ' +
        'built from them.';

    if (liveViews.has(next)) {
        diagnostics.report(
            'a connectSelection() snapshot handed a child a live store view as its whole value. ' + guidance
        );

        return true;
    }

    if (Array.isArray(next)) {
        const index = next.findIndex((member: unknown): boolean => liveViews.has(member));

        if (index !== -1) {
            diagnostics.report(
                'a connectSelection() snapshot handed a child a live store view as array member ' +
                index + '. ' + guidance
            );

            return true;
        }

        return false;
    }

    if (isPlainObject(next)) {
        // Binding narrowed ahead of the callback: a `.find` body runs outside the guard's
        // narrowing reach.
        const members: Record<string, unknown> = next;
        const key = Object.keys(members).find((memberKey: string): boolean => liveViews.has(members[memberKey]));

        if (key !== undefined) {
            diagnostics.report(
                'a connectSelection() snapshot handed a child a live store view as member "' +
                key + '". ' + guidance
            );

            return true;
        }
    }

    return false;
};

/**
 * Attempt-map key prefix for a `connect()` declaration's entry; the connection's uid follows
 * it. Connection uids and carburetor uids come from the same counter, so keying by kind keeps
 * the map self-describing about what each collected entry will publish to.
 */
const CONNECTION_ATTEMPT_KEY = 'c:';

/** Attempt-map key prefix for a `track()`ed source; the carburetor's uid follows it. */
const TRACKED_ATTEMPT_KEY = 't:';

/**
 * The property the render boundary intercepts, named once so every trap in the boundary proxy
 * agrees on it.
 */
const RENDER_KEY = 'render';

/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount or
 * shouldComponentUpdate. If you do override those, call the super implementation — otherwise
 * effects, subscription cleanup or the props gate will not work.
 */
export class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string = getUid();

    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<IEffectRecord> = {};

    /**
     * Carburetors read through `useCarburetor`/`useComputed`/`useResource`: one dependency slot
     * per carburetor, written by commits out of what a fresh render attempt collected.
     *
     * The committed descriptions outlive unmount: releaseSubscriptions keeps them, so a
     * replayed mount lifecycle can restore the subscriptions without a render to refill them.
     * The records themselves do not: a commit whose attempt never touched a record drops it.
     */
    protected tracked: IDict<ITrackedCarburetor> = {};

    /**
     * Persistent `connect()` declarations, in declaration order.
     *
     * Never pruned: a connection lives from the field initializer that created it until the
     * component itself is torn down, unlike `tracked`, which `commitSubscriptions` drops the
     * moment a render stops touching it. What a commit clears on an untouched connection is
     * its committed description — ending the subscription; the declaration stays reusable.
     */
    protected connections: IConnection[] = [];

    /** The render attempt currently open, if any; recorders write only while this is set. */
    protected renderAttempt: IRenderAttempt | undefined = undefined;

    /** The last closed attempt, waiting for the commit that may consume it. */
    protected pendingAttempt: IRenderAttempt | undefined = undefined;

    /**
     * The attempt the last commit consumed: identity, not a counter, says whether this commit
     * has a new render behind it.
     */
    protected committedAttempt: IRenderAttempt | undefined = undefined;

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
    constructor(props: Readonly<P>) {
        super(props);

        return this.withRenderBoundary();
    }

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
    public shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean {
        return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
    }

    /** Establishes the subscriptions this render collected, then fetches and runs effects. */
    public componentDidMount(): void {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.useEffects();
    }

    /** The same commit work as on mount, with the previous props' effects torn down first. */
    public componentDidUpdate(prevProps: Readonly<P>): void {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.unUseEffects(prevProps);
        this.useEffects();
    }

    /**
     * Releases everything this component holds: effect cleanups first, subscriptions last.
     *
     * Every stage runs isolated, so one that throws costs the component neither the stages after
     * it nor a store a subscription to a component that no longer exists — a cleanup that fails,
     * or the component-wide `unUseEffects` that does, must not be able to stop the release of
     * what follows. What the stages collected is reported once the whole teardown finished, the
     * way the store's delivery paths report their failures, rather than re-thrown into React's
     * unmount path.
     */
    public componentWillUnmount(): void {
        const failures: string[] = [];

        this.runTeardownStage('the component-wide unUseEffects callback threw while a component ' +
            'unmounted', () => this.unUseEffects(this.props), failures);
        this.runTeardownStage('an effect cleanup threw while a component unmounted',
            () => this.releaseEffects(), failures);
        this.runTeardownStage('releasing subscriptions threw while a component unmounted',
            () => this.releaseSubscriptions(), failures);

        failures.forEach((failure: string) => this.reportTeardownFailure(failure));
    }

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
        const getCarburetor: () => ICarburetor<T> = typeof source === 'function' ? source : () => source;

        const connection: IConnection = {uid: getUid(), getCarburetor, committed: undefined, installed: undefined};

        this.connections.push(connection);

        // The connection's source, resolved at most once per render attempt: the attempt's
        // first read resolves it into the attempt's collection, and every later read of the
        // same attempt — the recorder's baseline capture included — reuses that instance. The
        // memo lives and dies with the attempt, so no source selection is carried across
        // renders, and outside an attempt (an event read, the declaration-time shape probe)
        // nothing is cached: the resolver runs again, so a handler read still sees current
        // data. The underlying root is not part of this memo: view resolution re-reads
        // getData() on every access, so a setData() root replacement stays visible.
        const resolveAttemptSource = (): ICarburetor<T> => {
            const attempt = this.renderAttempt;

            if (!attempt) {
                return getCarburetor();
            }

            const key = CONNECTION_ATTEMPT_KEY + connection.uid;
            // The key is this connection's alone and only this closure writes it, so the value
            // it names is always the ICarburetor<T> this declaration resolved.
            const resolved = attempt.sources.get(key) as ICarburetor<T> | undefined;

            if (resolved !== undefined) {
                return resolved;
            }

            const carburetor = getCarburetor();

            attempt.sources.set(key, carburetor);

            return carburetor;
        };

        const recorder: TPathRecorder = (path: TPath): void => {
            const attempt = this.renderAttempt;

            // Outside a render attempt the read still gets current data, but records nothing:
            // a handler, effect or child callback can never alter a render's dependency set.
            if (!attempt) {
                return;
            }

            let entry = attempt.entries.get(CONNECTION_ATTEMPT_KEY + connection.uid);

            if (!entry) {
                // The source and its baseline version are captured once, at the beginning of
                // this attempt's consumption — not refreshed after every property access — so
                // a write landing mid-render or mid-commit stays detectable at commit time.
                // The source is not resolved again here: this read is arriving through the
                // view, whose resolution already fixed this attempt's source.
                const carburetor = resolveAttemptSource();

                entry = {
                    connection,
                    source: carburetor,
                    baselineVersion: carburetor.getVersion(),
                    reads: new Set<TPath>(),
                };
                attempt.entries.set(CONNECTION_ATTEMPT_KEY + connection.uid, entry);
            }

            entry.reads.add(path);
        };

        return this.buildPersistentView(getCarburetor, recorder, resolveAttemptSource);
    };

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
    private buildPersistentView = <T extends object>(
        getCarburetor: () => ICarburetor<T>,
        recorder: TPathRecorder,
        resolveAttemptSource: () => ICarburetor<T>
    ): TReadonly<T> => {
        let cachedTarget: T | undefined;
        let cachedView: TReadonly<T> | undefined;

        // Root-shape contract: the facade's object/array kind is fixed once, here, from the
        // source's current root — an array root declares an array-shaped facade (`[]` target:
        // `Array.isArray` true, `JSON.stringify` emits an array), anything else an
        // object-shaped one. A Proxy target cannot change after creation, so the kind cannot
        // either: a source that is not resolvable yet (a scope-backed resolver resolves only
        // after construction, once React fills context) declares an object-shaped facade, and
        // a later root of the other kind fails loudly in resolveView instead of serving a
        // silently wrong view.
        let arrayFacade = false;

        try {
            // A shape probe, not a read: no render attempt is open, so nothing records, and
            // nothing here subscribes — the declaration stays subscription-free until commit.
            arrayFacade = Array.isArray(getCarburetor().getData());
        } catch {
            // The source is not resolvable yet; the real resolution error, if any, surfaces
            // unguarded at the first real read below.
        }

        // A new underlying data object must keep the declared kind: same kind — the rebuild is
        // transparent (setData, restore, a source() swap); the other kind — an explicit
        // boundary error, because forwarding it would serve a view that answers basic
        // JavaScript questions (`Array.isArray`, key enumeration) wrongly.
        const assertDeclaredKind = (data: T): void => {
            if (Array.isArray(data) === arrayFacade) {
                return;
            }

            throw new Error(
                arrayFacade
                    ? 'Carburetor: this connect() view was declared for an array root, but its source now ' +
                      'resolves to a root that is not an array. One persistent view cannot change its ' +
                      'object/array kind; declare a separate connection for the other store.'
                    : 'Carburetor: this connect() view is fixed as an object view because its source was not ' +
                      'resolvable at declaration time (a scope-backed resolver resolves after construction), ' +
                      'but the resolved root is an array. Read an array-rooted scoped store through ' +
                      'useCarburetor in render instead.'
            );
        };

        // Rebuilds only when the wrapped data object itself changed — a normal field write
        // mutates that object in place, so this stays untouched render after render; only
        // setData()/restore() (a whole new object) or a source() swap to a different carburetor
        // (whose data is necessarily a different object) trigger a rebuild.
        const resolveView = (): TReadonly<T> => {
            // The attempt's shared resolution, not a fresh one per property access: reading
            // several fields in one render resolves the source once. The root itself is still
            // re-read per access — a setData() replacement must rebuild the view immediately.
            const carburetor = resolveAttemptSource();
            const data = carburetor.getData();

            if (cachedTarget !== data) {
                assertDeclaredKind(data);
                cachedTarget = data;
                cachedView = carburetor.read(recorder);
            }

            return cachedView as TReadonly<T>;
        };

        const forbidWrite = (): never => {
            throw new Error(
                'Carburetor: data read through connect() is read-only. ' +
                'Write through carburetor methods — they write via draft and know which paths changed.'
            );
        };

        // An empty object/array stands in for the real target: every trap below resolves and
        // forwards to the current view instead, which is what lets the same Proxy instance
        // survive a rebuild underneath it. Which of the two it is fixes the facade's kind.
        const facade = new Proxy((arrayFacade ? [] : {}) as unknown as TReadonly<T>, {
            get: (_target: TReadonly<T>, key: string | symbol): unknown => Reflect.get(resolveView() as object, key),
            has: (_target: TReadonly<T>, key: string | symbol): boolean => Reflect.has(resolveView() as object, key),
            ownKeys: (_target: TReadonly<T>): ArrayLike<string | symbol> => Reflect.ownKeys(resolveView() as object),
            getOwnPropertyDescriptor: (_target: TReadonly<T>, key: string | symbol): PropertyDescriptor | undefined => {
                const descriptor: PropertyDescriptor | undefined =
                    Reflect.getOwnPropertyDescriptor(resolveView() as object, key);

                if (descriptor === undefined || descriptor.configurable) {
                    return descriptor;
                }

                // A non-configurable view descriptor can often not be reported as-is: over the
                // empty facade target the engine answers with a bare proxy-invariant TypeError
                // and no explanation — the enumeration/serialization failure this facade
                // existed to fix. The one lawful representation there is the descriptor
                // relaxed to configurable, which grants nothing: set, deleteProperty,
                // defineProperty, setPrototypeOf and preventExtensions are all rejected below,
                // so the relaxed flag can never be acted on. A key the target itself holds as
                // a non-configurable own property (an array target's "length") must instead
                // be forwarded unchanged: relaxing it would contradict the target's existing
                // property, which the engine rejects, while forwarding stays compatible
                // because the target's own "length" remains writable.
                const targetDescriptor: PropertyDescriptor | undefined =
                    Reflect.getOwnPropertyDescriptor(_target as object, key);

                if (targetDescriptor !== undefined && !targetDescriptor.configurable) {
                    return descriptor;
                }

                return {...descriptor, configurable: true};
            },
            // Introspection stays truthful about the live data; the target stays extensible,
            // which is what keeps every forwarding trap lawful.
            getPrototypeOf: (_target: TReadonly<T>): object | null => Reflect.getPrototypeOf(resolveView() as object),
            // A prototype change or an extension change would invalidate the facade's
            // forwarding invariants (a non-extensible target must mirror the view's keys), so
            // both are rejected the same way as writes.
            setPrototypeOf: forbidWrite,
            preventExtensions: forbidWrite,
            set: forbidWrite,
            deleteProperty: forbidWrite,
            defineProperty: forbidWrite,
        }) as TReadonly<T>;

        // Noted so the child-prop snapshot boundary recognizes this view as live.
        liveViews.note(facade);

        return facade;
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
        const getCarburetor: () => ICarburetor<T> = typeof source === 'function' ? source : () => source;

        const connection: IConnection = {uid: getUid(), getCarburetor, committed: undefined, installed: undefined};

        this.connections.push(connection);

        // The connection's source, resolved at most once per render attempt: the attempt's
        // first read resolves it into the attempt's collection, and every later read of the
        // same attempt — the recorder's baseline capture included — reuses that instance. The
        // memo lives and dies with the attempt, so no source selection is carried across
        // renders, and outside an attempt (an event read, the declaration-time shape probe)
        // nothing is cached: the resolver runs again, so a handler read still sees current
        // data. The underlying root is not part of this memo: view resolution re-reads
        // getData() on every access, so a setData() root replacement stays visible.
        const resolveAttemptSource = (): ICarburetor<T> => {
            const attempt = this.renderAttempt;

            if (!attempt) {
                return getCarburetor();
            }

            const key = CONNECTION_ATTEMPT_KEY + connection.uid;
            // The key is this connection's alone and only this closure writes it, so the value
            // it names is always the ICarburetor<T> this declaration resolved.
            const resolved = attempt.sources.get(key) as ICarburetor<T> | undefined;

            if (resolved !== undefined) {
                return resolved;
            }

            const carburetor = getCarburetor();

            attempt.sources.set(key, carburetor);

            return carburetor;
        };

        const recorder: TPathRecorder = (path: TPath): void => {
            const attempt = this.renderAttempt;

            // Outside a render attempt the read still gets current data, but records nothing:
            // a handler, effect or child callback can never alter a render's dependency set.
            if (!attempt) {
                return;
            }

            let entry = attempt.entries.get(CONNECTION_ATTEMPT_KEY + connection.uid);

            if (!entry) {
                // The source and its baseline version are captured once, at the beginning of
                // this attempt's consumption — not refreshed after every property access — so
                // a write landing mid-render or mid-commit stays detectable at commit time.
                // The source is not resolved again here: this read is arriving through the
                // view, whose resolution already fixed this attempt's source.
                const carburetor = resolveAttemptSource();

                entry = {
                    connection,
                    source: carburetor,
                    baselineVersion: carburetor.getVersion(),
                    reads: new Set<TPath>(),
                };
                attempt.entries.set(CONNECTION_ATTEMPT_KEY + connection.uid, entry);
            }

            entry.reads.add(path);
        };

        const view = this.buildPersistentView(getCarburetor, recorder, resolveAttemptSource);

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
     * Wraps this instance in the render boundary proxy; the constructor hands the proxy to
     * React in place of `this`.
     *
     * Only `render` is special-cased — every other property forwards to the target untouched,
     * so the instance keeps its ordinary shape: own keys, property descriptors and the
     * prototype chain are the target's own. The raw render and the boundary built for it live
     * in this closure, so a boundary is built exactly once per raw render per instance.
     */
    private withRenderBoundary(): this {
        let rawRender: unknown;
        let boundary: (() => React.ReactNode) | undefined;
        let wrapped = false;

        const proxy = new Proxy(this as unknown as object, {
            get: (target: object, key: string | symbol): unknown => {
                if (key !== RENDER_KEY) {
                    return Reflect.get(target, key, target);
                }

                // A render the definition traps absorbed lives only in this closure; anything
                // else — a prototype-method render, or no render at all — is looked up on the
                // target like a plain property read.
                const raw = wrapped ? rawRender : Reflect.get(target, RENDER_KEY, target);

                if (typeof raw !== 'function') {
                    return raw;
                }

                // One boundary per raw render: a new render definition replaces the previous
                // one, and re-reading an unchanged render returns the boundary already built.
                if (boundary === undefined || rawRender !== raw) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw as () => React.ReactNode);
                }

                return boundary;
            },
            set: (target: object, key: string | symbol, value: unknown): boolean => {
                if (key !== RENDER_KEY) {
                    return Reflect.set(target, key, value, target);
                }

                // Absorbed, never forwarded: the render exists only through `get`, so there is
                // no plain own property a later read could bypass the boundary with.
                rawRender = value;
                wrapped = typeof value === 'function';
                boundary = wrapped ? this.buildRenderBoundary(value as () => React.ReactNode) : undefined;

                return true;
            },
            defineProperty: (target: object, key: string | symbol, descriptor: PropertyDescriptor): boolean => {
                if (key !== RENDER_KEY) {
                    return Reflect.defineProperty(target, key, descriptor);
                }

                // The [[Define]] form a class-field initializer uses lands here: the same
                // wrap-at-definition treatment as the assignment above.
                rawRender = descriptor.value;
                wrapped = typeof descriptor.value === 'function';

                if (wrapped) {
                    boundary = this.buildRenderBoundary(descriptor.value as () => React.ReactNode);
                } else {
                    boundary = undefined;
                }

                return true;
            },
            deleteProperty: (target: object, key: string | symbol): boolean => {
                if (key === RENDER_KEY) {
                    rawRender = undefined;
                    boundary = undefined;
                    wrapped = false;
                }

                return Reflect.deleteProperty(target, key);
            },
            has: (target: object, key: string | symbol): boolean =>
                key === RENDER_KEY ? wrapped || Reflect.has(target, RENDER_KEY) : Reflect.has(target, key),
        });

        return proxy as this;
    }

    /**
     * Builds the boundary around one raw render: opens a render attempt before it runs, marks
     * the attempt abandoned when the render throws (an error, or a Suspense thenable), and
     * closes it right after — a commit never consumes what an abandoned render collected.
     *
     * @param realRender - the subclass's own render, called with the raw instance as `this`
     */
    private buildRenderBoundary(realRender: () => React.ReactNode): () => React.ReactNode {
        return (): React.ReactNode => {
            const attempt = this.openRenderAttempt();

            try {
                return realRender.call(this);
            } catch (error: unknown) {
                attempt.abandoned = true;

                throw error;
            } finally {
                this.closeRenderAttempt(attempt);
            }
        };
    }

    /**
     * Opens a fresh render attempt: an empty entry map this render's reads will fill.
     *
     * Any previous tentative state is discarded by replacement — it simply stops being
     * reachable — so an abandoned collection can never bleed into a new attempt.
     */
    private openRenderAttempt(): IRenderAttempt {
        const attempt: IRenderAttempt = {
            entries: new Map<string, IAttemptEntry>(),
            sources: new Map<string, ICarburetorSubscription>(),
            deferredLoads: [],
            abandoned: false,
        };

        this.renderAttempt = attempt;

        return attempt;
    }

    /**
     * Closes a render attempt: it becomes the candidate the next commit may consume.
     *
     * From here until the next open there is no current attempt, so nothing records: the
     * render→commit gap is inert, and reads through captured views — from handlers, effects or
     * other components' callbacks — cannot alter this render's dependency set.
     *
     * @param attempt - the attempt just closed; kept as pending even when the render threw
     */
    private closeRenderAttempt(attempt: IRenderAttempt): void {
        this.pendingAttempt = attempt;
        this.renderAttempt = undefined;
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

    /**
     * Where a subclass declares its effects; called after every commit.
     */
    protected useEffects(): void {
    }

    // noinspection JSUnusedLocalSymbols
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void {
    }

    /**
     * Reports one failure a teardown or an effect replacement collected, dev only.
     *
     * Reporting is the last thing these paths do with a failure: a callback that failed must be
     * heard about, but never at the cost of the work queued behind it or of React's lifecycle
     * seeing the error. The guard is the one the store's delivery paths use, so a production
     * build reports nothing.
     *
     * @param failure - the message to report, already naming what ran and what it cost
     */
    private reportTeardownFailure = (failure: string): void => {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            diagnostics.report(failure);
        }
    };

    /**
     * Runs one stage of the unmount teardown, isolated so a failure there costs the stages after
     * it nothing.
     *
     * The failure is filed as the message its report will use and the caller moves on: nothing
     * here throws, whatever the stage does.
     *
     * @param what - the sentence fragment naming the stage, for the failure message
     * @param stage - the stage itself
     * @param failures - the messages collected so far, appended to when the stage throws
     */
    private runTeardownStage = (what: string, stage: () => void, failures: string[]): void => {
        try {
            stage();
        } catch (error: unknown) {
            failures.push(what + ': ' + describeFailure(error) + '. The teardown completed anyway.');
        }
    };

    /**
     * Runs `callBack` when its dependencies changed since the last run.
     *
     * Whatever the effect returns is treated as its cleanup and is run before the effect runs
     * again, and on unmount — so setup and teardown stay paired per effect rather than being
     * one global hook for the whole component.
     *
     * A replaced cleanup is teardown work, so it runs isolated: its failure is reported once the
     * replacement finished, never thrown at the new run. The record moves to the new deps before
     * the setup runs and holds no cleanup until the setup returns one, so a setup that throws
     * leaves the record consistent — new deps, no cleanup — instead of a stale cleanup a later
     * unmount would run a second time.
     *
     * @param callBack - the effect body; a function it returns becomes the cleanup, run before
     * the next run and on unmount
     * @param name - the key in the per-effect record, so two effects sharing one name would
     * overwrite each other's deps and cleanup
     * @param deps - compared shallowly with the last run's; an equal set skips the run and
     * leaves the existing cleanup standing
     */
    protected useEffect = (callBack: TEffect, name: string, deps: TEffectDeps): void => {
        const known = this.effects[name];

        if (known && shallowEqual(known.deps, deps)) {
            return;
        }

        // The replaced cleanup is teardown work: it must not cost us the new run, so its
        // failure waits for the report until the replacement finished.
        const failures: unknown[] = [];

        if (known && known.cleanup) {
            try {
                known.cleanup();
            } catch (error: unknown) {
                failures.push(error);
            }
        }

        // A fresh record, so the setup that follows writes deps and cleanup itself: a setup
        // that throws leaves the new deps standing with no cleanup, and no reference anywhere
        // still points at the cleanup that already ran.
        const record: IEffectRecord = {deps, cleanup: undefined};

        this.effects[name] = record;

        try {
            const cleanup = callBack();

            record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        } finally {
            failures.forEach((error: unknown) => this.reportTeardownFailure(
                'an effect cleanup threw while an effect was replaced: ' +
                describeFailure(error) + '. The new effect ran anyway.'
            ));
        }
    };

    /**
     * Runs every effect's cleanup once, on unmount, and forgets them.
     *
     * Each cleanup is isolated, so one that throws costs the cleanups after it neither their
     * turn nor their record: the whole set is dropped once every cleanup has had its turn, and
     * what they collected is reported instead of thrown into the unmount that called this.
     */
    protected releaseEffects(): void {
        const records = this.effects;

        this.effects = {};

        const failures: unknown[] = [];

        Object.keys(records).forEach((name: string) => {
            const cleanup = records[name].cleanup;

            if (cleanup) {
                try {
                    cleanup();
                } catch (error: unknown) {
                    failures.push(error);
                }
            }
        });

        failures.forEach((error: unknown) => this.reportTeardownFailure(
            'an effect cleanup threw while a component unmounted: ' +
            describeFailure(error) + '. The teardown completed anyway.'
        ));
    }

    /**
     * What a carburetor calls when a path this component read was written.
     *
     * `forceUpdate` deliberately skips `shouldComponentUpdate`: the props gate must not be able
     * to swallow an update the component is itself subscribed to.
     */
    protected onCarburetorUpdate = (): void => {
        this.forceUpdate();
    };

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
    protected commitSubscriptions(): void {
        const attempt = this.pendingAttempt;

        // A commit consumes a render attempt exactly once, and only a fresh one: StrictMode's
        // replayed mount and a Suspense hide/reveal commit again with NO new render behind
        // them — identity with the last consumed attempt is what tells those apart from a
        // real render, so a replay restores the last committed description instead of being
        // mistaken for an empty render.
        const fresh = attempt !== undefined && !attempt.abandoned && attempt !== this.committedAttempt;

        if (fresh) {
            this.committedAttempt = attempt;

            // A record the attempt did not touch is gone from the render: release its
            // subscription and drop the record. A connection the attempt did not touch keeps
            // its declaration but loses its committed description — and with it, below, the
            // subscription: an unused connection must have no active read subscription.
            Object.keys(this.tracked).forEach((cuid: string) => {
                if (attempt.entries.has(TRACKED_ATTEMPT_KEY + cuid)) {
                    return;
                }

                this.releaseSlot(this.uid, this.tracked[cuid]);
                delete this.tracked[cuid];
            });

            this.connections.forEach((connection: IConnection) => {
                if (!attempt.entries.has(CONNECTION_ATTEMPT_KEY + connection.uid)) {
                    connection.committed = undefined;
                }
            });

            // What the attempt read becomes the new committed description. The set is copied
            // at this tentative-to-committed transition so a later read through a stale
            // captured view cannot alter what a commit established.
            attempt.entries.forEach((entry: IAttemptEntry, key: string) => {
                const description: IDependencyDescription = {
                    carburetor: entry.source,
                    baselineVersion: entry.baselineVersion,
                    reads: new Set<TPath>(entry.reads),
                };

                if (entry.connection) {
                    entry.connection.committed = description;

                    return;
                }

                const cuid = key.slice(TRACKED_ATTEMPT_KEY.length);
                const known = this.tracked[cuid];

                this.tracked[cuid] = {
                    committed: description,
                    installed: known ? known.installed : undefined,
                };
            });
        }

        let changedDuringRender = false;

        Object.keys(this.tracked).forEach((cuid: string) => {
            if (this.alignSubscription(this.uid, this.tracked[cuid])) {
                changedDuringRender = true;
            }
        });

        this.connections.forEach((connection: IConnection) => {
            if (this.alignSubscription(connection.uid, connection)) {
                changedDuringRender = true;
            }
        });

        if (changedDuringRender) {
            this.forceUpdate();
        }
    }

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
    private alignSubscription(uid: string, slot: IDependencySlot): boolean {
        const committed = slot.committed;
        const installed = slot.installed;

        if (!committed) {
            if (installed) {
                installed.carburetor.unsubscribe(uid);
                slot.installed = undefined;
            }

            return false;
        }

        if (installed && installed.carburetor !== committed.carburetor) {
            installed.carburetor.unsubscribe(uid);
            slot.installed = undefined;
        }

        // An unchanged read set skips re-registering: SubscriberIndex would remove and
        // re-walk every ancestor of every path only to arrive at the same entries — pure
        // cost. The version check below still runs either way.
        if (slot.installed === undefined || !sameReads(slot.installed.reads, committed.reads)) {
            // Subscribing with the slot's own id replaces the previous registration instead of
            // adding a second one. The carburetor copies the read set, so reads happening later
            // outside render cannot extend an established subscription.
            committed.carburetor.subscribe(this.onCarburetorUpdate, {id: uid, reads: committed.reads});
            slot.installed = {carburetor: committed.carburetor, reads: new Set<TPath>(committed.reads)};
        }

        return committed.carburetor.getVersion() !== committed.baselineVersion;
    }

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
    private releaseSlot(uid: string, slot: IDependencySlot): void {
        if (slot.installed) {
            slot.installed.carburetor.unsubscribe(uid);
            slot.installed = undefined;
        }
    }

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
    protected releaseSubscriptions(): void {
        Object.keys(this.tracked).forEach((cuid: string) => {
            this.releaseSlot(this.uid, this.tracked[cuid]);
        });

        this.connections.forEach((connection: IConnection) => {
            this.releaseSlot(connection.uid, connection);
        });

        this.renderAttempt = undefined;
    }
}
