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
    /** Resolves the carburetor to read; called at an attempt's first read, so a prop swap is noticed. */
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
 * Whether a fresh selection has the same content as the snapshot already handed out. This is
 * deliberately the same comparison a child's props gate applies, so "same" here means the
 * handed-out snapshot may keep its identity — and the gated child keeps its bail-out. The
 * detached previous snapshot is compared against the raw fresh selection: a shallow copy
 * shares every member with its source, so identity differences introduced by detaching say
 * nothing about content.
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

    const previousKeys = Object.keys(snapshot);
    const freshKeys = Object.keys(next);

    if (previousKeys.length !== freshKeys.length) {
        return false;
    }

    // Bindings narrowed ahead of the callback: a `.every` body runs outside the guards'
    // narrowing reach.
    const previousMembers = snapshot as Record<string, unknown>;
    const freshMembers = next as Record<string, unknown>;

    return previousKeys.every((key: string): boolean => Object.is(previousMembers[key], freshMembers[key]));
};

/**
 * The detached form of a selection's value — the form safe to hand a child.
 *
 * Plain objects and arrays are shallow-copied, so a child receives plain data that outlives
 * the render instead of a branch of the live view; a branch read inside the child's own render
 * would record nothing and sit under no subscription. Primitives are detached by being values.
 * Exotic objects (Map, Date, class instances) would lose their prototype to a copy, so they
 * pass as is.
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
 * The render wrappers already installed, per instance: a guard that keeps a render wrapped
 * exactly once even though both the constructor and `UNSAFE_componentWillMount` offer to do
 * it — the constructor catches prototype-method renders, the mount hook catches class-field
 * renders, and either can run when the other has already wrapped.
 */
const renderBoundaries = new WeakSet<object>();

/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount,
 * shouldComponentUpdate or UNSAFE_componentWillMount. If you do override those, call the
 * super implementation — otherwise effects, subscription cleanup, the props gate or the
 * render boundary will not work.
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

    /** Stale entries this render found. Fetched after the commit — never during render. */
    protected staleResources: (() => void)[] = [];

    /**
     * Wraps a prototype-method `render` with the render-attempt boundary before any field
     * initializer runs: a subclass's prototype `render` is already reachable here, while a
     * class-field one is not initialized yet — the mount hook below catches that shape.
     *
     * @param props - forwarded to `React.Component` untouched
     */
    constructor(props: Readonly<P>) {
        super(props);

        this.wrapRender();
    }

    // The boundary must exist before the first render, and this is the only React hook that
    // runs after subclass field initializers; UNSAFE_ is the supported, warning-free spelling.
    // oxlint-disable react/no-unsafe
    /**
     * Catches a class-field `render`: its initializer runs after the base constructor and
     * clobbers a boundary installed there, and React calls this hook after every field
     * initializer and before the first render — `renderBoundaries` makes a second wrap a no-op.
     */
    public UNSAFE_componentWillMount(): void {
        this.wrapRender();
    }
    // oxlint-enable react/no-unsafe

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

    /** Releases everything this component holds: effect cleanups first, subscriptions last. */
    public componentWillUnmount(): void {
        this.unUseEffects(this.props);
        this.releaseEffects();
        this.releaseSubscriptions();
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
                const carburetor = getCarburetor();

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

        return this.buildPersistentView(getCarburetor, recorder);
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
     */
    private buildPersistentView = <T extends object>(
        getCarburetor: () => ICarburetor<T>,
        recorder: TPathRecorder
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
            const carburetor = getCarburetor();
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
    public connectSelection = <T extends object, R>(
        source: ICarburetor<T> | (() => ICarburetor<T>),
        select: (data: TReadonly<T>) => R
    ): (() => R) => {
        const getCarburetor: () => ICarburetor<T> = typeof source === 'function' ? source : () => source;

        const connection: IConnection = {uid: getUid(), getCarburetor, committed: undefined, installed: undefined};

        this.connections.push(connection);

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
                const carburetor = getCarburetor();

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

        const view = this.buildPersistentView(getCarburetor, recorder);

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

        if (worthFetching) {
            this.staleResources.push(() => {
                void source.load(args);
            });
        }

        return view;
    };

    /** Runs the fetches render queued, now that the subscriptions they need exist. */
    protected loadStaleResources(): void {
        const queued = this.staleResources;

        this.staleResources = [];

        queued.forEach((load: () => void) => load());
    }

    /**
     * Replaces the subclass's `render` with a boundary that opens a render attempt around it.
     *
     * A boundary is installed once per instance: `renderBoundaries` recognizes a render that is
     * already a boundary, and a `render` that is not a function — React.Component has no runtime
     * prototype `render`, so there is nothing to wrap before a subclass defines one — is left
     * alone for the mount hook to catch.
     */
    private wrapRender(): void {
        const realRender = this.render as unknown;

        if (typeof realRender !== 'function' || renderBoundaries.has(realRender)) {
            return;
        }

        const boundary = (): React.ReactNode => {
            const attempt = this.openRenderAttempt();

            try {
                return (realRender as () => React.ReactNode).call(this);
            } catch (error: unknown) {
                // A render that throws (an error, or a Suspense thenable) never publishes what
                // it collected: the attempt is marked abandoned and a commit will not consume it.
                attempt.abandoned = true;

                throw error;
            } finally {
                this.closeRenderAttempt(attempt);
            }
        };

        renderBoundaries.add(boundary);
        this.render = boundary as unknown as () => React.ReactNode;
    }

    /**
     * Opens a fresh render attempt: an empty entry map this render's reads will fill.
     *
     * Any previous tentative state is discarded by replacement — it simply stops being
     * reachable — so an abandoned collection can never bleed into a new attempt.
     */
    private openRenderAttempt(): IRenderAttempt {
        const attempt: IRenderAttempt = {entries: new Map<string, IAttemptEntry>(), abandoned: false};

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

        let entry = attempt.entries.get(TRACKED_ATTEMPT_KEY + source.getUID());

        if (!entry) {
            entry = {connection: undefined, source, baselineVersion: source.getVersion(), reads: new Set<TPath>()};
            attempt.entries.set(TRACKED_ATTEMPT_KEY + source.getUID(), entry);
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
    protected useEffect = (callBack: TEffect, name: string, deps: TEffectDeps): void => {
        const known = this.effects[name];

        if (known && shallowEqual(known.deps, deps)) {
            return;
        }

        if (known && known.cleanup) {
            known.cleanup();
        }

        const cleanup = callBack();

        this.effects[name] = {
            deps,
            cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        };
    };

    /** Runs every effect's cleanup once, on unmount, and forgets them. */
    protected releaseEffects(): void {
        Object.keys(this.effects).forEach((name: string) => {
            const cleanup = this.effects[name].cleanup;

            if (cleanup) {
                cleanup();
            }
        });

        this.effects = {};
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
