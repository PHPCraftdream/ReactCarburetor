"use client";

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
     * Installs the render-attempt boundary as a non-configurable own accessor, so the moment
     * `render` first exists — a prototype method looked up through it, or a value later
     * assigned to it — it is wrapped.
     *
     * An own instance accessor, not a prototype one: class fields are installed with
     * `Object.defineProperty` semantics, which would replace an inherited prototype accessor
     * instead of calling it, so only an own property installed ahead of the subclass's own
     * field initializers can intercept anything. It has to be installed here rather than from
     * a React lifecycle hook, too: React never calls a mount hook for a component that defines
     * `getDerivedStateFromProps` or `getSnapshotBeforeUpdate`, so a fallback installed there
     * silently never runs for exactly those components.
     *
     * `configurable: false` is what makes a class-field `render` fail loudly instead of
     * quietly replacing the accessor: a field initializer defines its property with
     * `configurable: true`, and redefining a non-configurable property to one that is
     * configurable is rejected outright, so the engine throws `TypeError: Cannot redefine
     * property: 'render'` at construction, before the component ever renders. A configurable
     * accessor would instead let the field initializer silently overwrite it — the mount's
     * first render would already run unwrapped, with no render-attempt open, before any later
     * check could catch it. `no-lifecycle-class-property` (H13) is what turns this into a
     * clear, actionable message: it flags a class-field `render` at lint time, before the
     * throw ever happens at runtime.
     *
     * The setter stays reachable through plain assignment (`this.render = fn`, typically from
     * a constructor body): assignment goes through `[[Set]]`, which calls an accessor's setter,
     * not `[[DefineOwnProperty]]` — the two are distinguishable at the engine level, which is
     * why one can stay supported while the other is rejected.
     */
    private installRenderBoundary(): void {
        let rawRender: unknown;
        let boundary: (() => React.ReactNode) | undefined;
        let assigned = false;

        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: (): unknown => {
                const raw = assigned ? rawRender : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);

                if (typeof raw !== 'function') {
                    return raw;
                }

                if (boundary === undefined || raw !== rawRender) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw as () => React.ReactNode);
                }

                return boundary;
            },
            set: (value: unknown): void => {
                assigned = typeof value === 'function';
                rawRender = value;
                boundary = assigned ? this.buildRenderBoundary(value as () => React.ReactNode) : undefined;
            },
        });
    }

    /**
     * Installs the render boundary once `super` has wired up React's own instance state.
     *
     * @param props - forwarded to `React.Component` untouched
     */
    constructor(props: Readonly<P>) {
        super(props);

        this.installRenderBoundary();
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
     * Builds the boundary around one raw render: opens a render attempt before it runs, marks
     * the attempt abandoned when the render throws (an error, or a Suspense thenable), and
     * closes it right after — a commit never consumes what an abandoned render collected.
     *
     * `realRender` runs against `this`, the real instance — there is no proxy standing in for
     * it, so a subclass's native `#private` field or accessor brand-checks the exact object it
     * was installed on and just works.
     *
     * @param realRender - the subclass's own render
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


    protected abstract loadStaleResources(): void;
    protected abstract useEffects(): void;
    protected abstract unUseEffects(prevProps: P): void;
    protected abstract releaseEffects(): void;
    protected abstract commitSubscriptions(): void;
    protected abstract releaseSubscriptions(): void;
    protected abstract reportTeardownFailure(failure: string): void;
    protected abstract runTeardownStage(what: string, stage: () => void, failures: string[]): void;
}
