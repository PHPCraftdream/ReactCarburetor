import * as React from "react";
import {IDict, TEffectCleanup, TEffectDeps} from "@/Carburetor/Models/Base";
import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {
    IAttemptEntry,
    IConnection,
    IRenderAttempt,
    ITrackedCarburetor,
} from "@/Carburetor/Component/Models/Connection";
import {shallowEqual} from "@/Carburetor/Component/shallowEqual";
const RENDER_KEY = "render";

export abstract class AntiHookComponentFoundation<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string = getUid();

    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<{deps: TEffectDeps; cleanup: TEffectCleanup | undefined}> = {};

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
        this.runTeardownStage("releasing a connect() view's cache threw while a component unmounted",
            () => this.releaseConnectionViews(), failures);

        failures.forEach((failure: string) => this.reportTeardownFailure(failure));
    }

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
    private withRenderBoundary(): this {
        let rawRender: unknown;
        let boundary: (() => React.ReactNode) | undefined;
        let wrapped = false;

        // Assigned once, immediately below, to the proxy this method returns — before any trap
        // can possibly fire, since a derived class's field initializers (which is what runs a
        // class-field `render`'s `defineProperty` trap, or installs a native `#field`) only run
        // once this whole constructor call has returned. Every trap below reads it lazily, at
        // invocation time, never at closure-creation time, so this forward reference is safe.
        let receiver: object;

        const proxy = new Proxy(this as unknown as object, {
            get: (target: object, key: string | symbol): unknown => {
                if (key !== RENDER_KEY) {
                    return Reflect.get(target, key, receiver);
                }

                // A render the definition traps absorbed lives only in this closure; anything
                // else — a prototype-method render, or no render at all — is looked up on the
                // target like a plain property read.
                const raw = wrapped ? rawRender : Reflect.get(target, RENDER_KEY, receiver);

                if (typeof raw !== 'function') {
                    return raw;
                }

                // One boundary per raw render: a new render definition replaces the previous
                // one, and re-reading an unchanged render returns the boundary already built.
                if (boundary === undefined || rawRender !== raw) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw as () => React.ReactNode, receiver);
                }

                return boundary;
            },
            set: (target: object, key: string | symbol, value: unknown): boolean => {
                if (key !== RENDER_KEY) {
                    return Reflect.set(target, key, value, receiver);
                }

                // Absorbed, never forwarded: the render exists only through `get`, so there is
                // no plain own property a later read could bypass the boundary with.
                rawRender = value;
                wrapped = typeof value === 'function';
                boundary = wrapped ? this.buildRenderBoundary(value as () => React.ReactNode, receiver) : undefined;

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
                    boundary = this.buildRenderBoundary(descriptor.value as () => React.ReactNode, receiver);
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

        receiver = proxy;

        return proxy as this;
    }

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
    private buildRenderBoundary(realRender: () => React.ReactNode, receiver: object): () => React.ReactNode {
        return (): React.ReactNode => {
            const attempt = this.openRenderAttempt();

            try {
                return realRender.call(receiver);
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
