import { AntiHookComponentEffects } from "./Effects.mjs";
export declare abstract class AntiHookComponentSubscriptions<P = {}, S = {}> extends AntiHookComponentEffects<P, S> {
    /**
     * What a carburetor calls when a path this component read was written.
     *
     * `forceUpdate` deliberately skips `shouldComponentUpdate`: the props gate must not be able
     * to swallow an update the component is itself subscribed to.
     *
     * Stays a per-instance arrow field rather than a shared prototype method: `subscribe` is
     * handed a detached callback it stores and invokes with no receiver, so whatever reaches
     * the store must already be bound to this instance. `renderGetter`/`renderSetter` can be one
     * shared static pair (R14-05) only because React looks `render` up as a property of `this`
     * and calls it as a method; a callback handed to `subscribe` gets no such lookup, so a bound
     * function costs the same one-object-per-instance as this closure does. Subscribing keys by
     * `uid`, not by this function's identity, but the identity still has to exist somewhere to
     * be callable at all.
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
     * Returns the tracked map, allocating it on first use.
     *
     * A `connect()`-only component never calls `useCarburetor`/`useComputed`/`useResource`, so
     * it never needs this map; allocating it here, rather than as a class field default, keeps
     * that component from paying for a collection it will never fill.
     */
    private ensureTracked;
    /**
     * Builds a fresh committed description out of one attempt entry.
     *
     * @param entry - the attempt's record for the source being committed
     */
    private buildDescription;
    /**
     * Publishes one attempt entry onto a slot's committed description, reusing the existing
     * description object when there is one instead of allocating a fresh one every commit.
     *
     * Safe to mutate in place: a committed description is read only through `slot.committed`
     * inside `alignSubscription`, in the same synchronous call that follows this one, and is
     * never held past it or compared by identity anywhere else.
     *
     * @param slot - the tracked slot or connection being committed
     * @param entry - the attempt's record for the source being committed
     */
    private applyDescription;
    /**
     * Brings one slot's registration in line with its committed description.
     *
     * No description means nothing may be listening: an installed handle is unsubscribed and
     * cleared. Otherwise a handle pointing at another carburetor is dropped first, and an
     * unchanged read set skips re-registering. Returns the drift check: whether a write that
     * could concern the committed read set landed between the render's read and this commit —
     * anchored to the baseline captured at the attempt's first read, not refreshed after every
     * access, which is what keeps an unused connection from looping forceUpdate forever.
     *
     * A version equal to the baseline means nothing was written at all since then, so there is
     * nothing further to check. A version that moved asks the source's own write log (R16-05)
     * which paths actually changed, and reports a drift only when one of them concerns what was
     * read — the same three cases `SubscriberIndex.match` uses: the same path, a written
     * ancestor, a written descendant. A source with no such log (`hasDriftSince` absent, e.g. a
     * computed, which invalidates at the granularity of its whole value) keeps today's coarser
     * answer: any version change is a drift.
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
