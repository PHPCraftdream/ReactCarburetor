"use client";

import * as React from "react";
import {IDict, TEffectCleanup, TEffectDeps} from "@/Carburetor/Models/Base";
import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {
    IConnection,
    IRenderAttempt,
    ITrackedCarburetor,
} from "@/Carburetor/Component/Models/Connection";
import {shallowEqual} from "@/Carburetor/Component/shallowEqual";
import {renderOwner} from "@/Carburetor/Derived/renderOwner";
// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

const RENDER_KEY = "render";

/**
 * Keys for the render accessor's per-instance state (`installRenderBoundary`). Symbol-keyed so
 * no subclass field name, however generic, can ever collide with them: `renderRaw`, `boundary`
 * or `assigned` are all plausible names for a subclass's own state.
 */
const RENDER_RAW: unique symbol = Symbol('carburetor.antiHookComponent.renderRaw');
const RENDER_BOUNDARY: unique symbol = Symbol('carburetor.antiHookComponent.renderBoundary');
const RENDER_ASSIGNED: unique symbol = Symbol('carburetor.antiHookComponent.renderAssigned');

/** Formats an unmount-teardown failure the same way Effects.tsx's own describeFailure does. */
const describeUnmountFailure = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error));

export abstract class AntiHookComponentFoundation<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string = getUid();

    /**
     * Per-effect state: the deps it last ran with, and the cleanup it returned.
     *
     * Absent until the first `useEffect` call: a component that declares no effects never
     * allocates this dictionary.
     */
    protected effects: IDict<{deps: TEffectDeps; cleanup: TEffectCleanup | undefined}> | undefined = undefined;

    /**
     * Carburetors read through `useCarburetor`/`useComputed`/`useResource`: one dependency slot
     * per carburetor, keyed by the carburetor itself and written by commits out of what a fresh
     * render attempt collected.
     *
     * Absent until the first commit that has something to track: a `connect()`-only component
     * never reads through `useCarburetor`/`useComputed`/`useResource`, so it never allocates
     * this map.
     *
     * The committed descriptions outlive unmount: releaseSubscriptions keeps them, so a
     * replayed mount lifecycle can restore the subscriptions without a render to refill them.
     * The records themselves do not: a commit whose attempt never touched a record drops it.
     */
    protected tracked: Map<ICarburetorSubscription, ITrackedCarburetor> | undefined = undefined;

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

    /** The raw render last seen: the prototype's, or whatever a constructor assigned. */
    private [RENDER_RAW]: unknown = undefined;

    /** The boundary built around the current raw render; rebuilt only when that render changes. */
    private [RENDER_BOUNDARY]: (() => React.ReactNode) | undefined = undefined;

    /** Whether a constructor assigned `render` directly, rather than leaving it on the prototype. */
    private [RENDER_ASSIGNED] = false;

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
     *
     * `get`/`set` are one shared function pair, not per-instance closures: V8 keeps accessor
     * functions in the hidden class, so a fresh pair per instance drops every instance after the
     * first into dictionary-mode properties. The state the pair needs lives in symbol-keyed fields.
     */
    private installRenderBoundary(): void {
        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: AntiHookComponentFoundation.renderGetter,
            set: AntiHookComponentFoundation.renderSetter,
        });
    }

    /**
     * Reads `render`: the value a constructor assigned, or else the prototype's, wrapped in the
     * boundary that opens and closes a render attempt around it.
     *
     * Static, and referenced through the base class, so every instance shares it and no subclass
     * member of the same name can replace it. Rebuilds the boundary only when the raw render changed.
     */
    private static renderGetter(this: AntiHookComponentFoundation<unknown, unknown>): unknown {
        const raw = this[RENDER_ASSIGNED]
            ? this[RENDER_RAW]
            : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);

        if (typeof raw !== 'function') {
            return raw;
        }

        if (this[RENDER_BOUNDARY] === undefined || raw !== this[RENDER_RAW]) {
            this[RENDER_RAW] = raw;
            this[RENDER_BOUNDARY] = this.buildRenderBoundary(raw as () => React.ReactNode);
        }

        return this[RENDER_BOUNDARY];
    }

    /**
     * Sets `render` directly — typically a constructor assignment — and rebuilds the boundary
     * around the new value right away.
     *
     * Shared the same way as `renderGetter`.
     *
     * @param this - the instance whose `render` is assigned
     * @param value - the value assigned to `this.render`; wrapped only when it is a function
     */
    private static renderSetter(this: AntiHookComponentFoundation<unknown, unknown>, value: unknown): void {
        this[RENDER_ASSIGNED] = typeof value === 'function';
        this[RENDER_RAW] = value;
        this[RENDER_BOUNDARY] = this[RENDER_ASSIGNED]
            ? this.buildRenderBoundary(value as () => React.ReactNode)
            : undefined;
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

        // Each stage is inlined rather than run through a shared helper taking a callback: a
        // fresh arrow per stage per unmount is exactly the kind of per-call allocation R16-09
        // removes, and the three stages differ only in which method runs and what to say if it
        // throws, so a loop would need the same three closures to describe them.
        try {
            this.unUseEffects(this.props);
        } catch (error: unknown) {
            failures.push('the component-wide unUseEffects callback threw while a component ' +
                'unmounted: ' + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }

        try {
            this.releaseEffects();
        } catch (error: unknown) {
            failures.push('an effect cleanup threw while a component unmounted: ' +
                describeUnmountFailure(error) + '. The teardown completed anyway.');
        }

        try {
            this.releaseSubscriptions();
        } catch (error: unknown) {
            failures.push('releasing subscriptions threw while a component unmounted: ' +
                describeUnmountFailure(error) + '. The teardown completed anyway.');
        }

        for (let i = 0; i < failures.length; i++) {
            this.reportTeardownFailure(failures[i]);
        }
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
            // Only the development escape diagnostic reads the owner; production allocates nothing here.
            const development = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
            const previousOwner = development ? renderOwner.get() : undefined;

            if (development) {
                renderOwner.set({
                    uid: this.uid,
                    hasTracked: (source) => attempt.tracked !== undefined && attempt.tracked.has(source),
                });
            }

            try {
                return realRender.call(this);
            } catch (error: unknown) {
                attempt.abandoned = true;

                throw error;
            } finally {
                if (development) {
                    renderOwner.set(previousOwner);
                }

                this.closeRenderAttempt(attempt);
            }
        };
    }

    /**
     * Opens a fresh render attempt: every collection starts absent, and is allocated by
     * whichever read API first needs it during this render.
     *
     * Any previous tentative state is discarded by replacement — it simply stops being
     * reachable — so an abandoned collection can never bleed into a new attempt.
     */
    private openRenderAttempt(): IRenderAttempt {
        const attempt: IRenderAttempt = {
            tracked: undefined,
            connections: undefined,
            deferredLoads: undefined,
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
}
