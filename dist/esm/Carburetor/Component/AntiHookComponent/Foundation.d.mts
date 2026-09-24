import * as React from "react";
import { IDict, TEffectCleanup, TEffectDeps } from "../../Models/Base.mjs";
import { IConnection, IRenderAttempt, ITrackedCarburetor } from "../Models/Connection.mjs";
export declare abstract class AntiHookComponentFoundation<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string;
    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<{
        deps: TEffectDeps;
        cleanup: TEffectCleanup | undefined;
    }>;
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
    componentWillUnmount(): void;
    /**
     * Wraps this instance in the render boundary proxy; the constructor hands the proxy to
     * React in place of `this`.
     *
     * Only `render` is special-cased — every other property forwards to the target untouched,
     * so the instance keeps its ordinary shape: own keys, property descriptors and the
     * prototype chain are the target's own. The raw render and the boundary built for it live
     * in this closure, so a boundary is built exactly once per raw render per instance.
     *
     * The ordinary get/set traps forward through `receiver` (this same proxy), not `target`
     * (R4-01): a subclass getter/setter that touches a native `#private` field runs with
     * `this` bound to whichever object `Reflect.get`/`Reflect.set` were given as receiver, and
     * that field was installed on the proxy (a derived constructor's returned object replaces
     * `this` for the rest of construction). Forwarding through the raw target instead brand-
     * checked the wrong object and threw. Plain data properties — `props`, `state`, React's own
     * internal fields — are unaffected either way: a receiver only matters to an accessor.
     */
    private withRenderBoundary;
    /**
     * Builds the boundary around one raw render: opens a render attempt before it runs, marks
     * the attempt abandoned when the render throws (an error, or a Suspense thenable), and
     * closes it right after — a commit never consumes what an abandoned render collected.
     *
     * The render-attempt bookkeeping stays anchored to the raw base instance (`this`, closed
     * over here) regardless of receiver: `renderAttempt`/`pendingAttempt` are ordinary fields,
     * not native `#private` ones, so there is exactly one logical component either way.
     *
     * @param realRender - the subclass's own render
     * @param receiver - the object `realRender` runs against: the proxy this constructor
     * returns, not the raw instance — a subclass's native `#private` field is installed on
     * that returned proxy (whatever a derived constructor returns becomes `this` for the rest
     * of construction, including field initializers), and native private access brand-checks
     * its receiver, so calling `realRender` against anything else throws for a subclass that
     * uses one
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
    protected abstract loadStaleResources(): void;
    protected abstract useEffects(): void;
    protected abstract unUseEffects(prevProps: P): void;
    protected abstract releaseEffects(): void;
    protected abstract commitSubscriptions(): void;
    protected abstract releaseSubscriptions(): void;
    protected abstract releaseConnectionViews(): void;
    protected abstract reportTeardownFailure: (failure: string) => void;
    protected abstract runTeardownStage: (what: string, stage: () => void, failures: string[]) => void;
}
