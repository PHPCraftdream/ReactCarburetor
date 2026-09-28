import { AntiHookComponentEffects } from "./Effects.mjs";
export declare abstract class AntiHookComponentSubscriptions<P = {}, S = {}> extends AntiHookComponentEffects<P, S> {
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
