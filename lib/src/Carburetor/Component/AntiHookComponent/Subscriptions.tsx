"use client";

import {TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {
    IAttemptEntry,
    IConnection,
    IDependencyDescription,
    IDependencySlot,
    ITrackedCarburetor,
} from "@/Carburetor/Component/Models/Connection";
import {AntiHookComponentEffects} from "./Effects";

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
export abstract class AntiHookComponentSubscriptions<P = {}, S = {}> extends AntiHookComponentEffects<P, S> {
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

            const trackedEntries = attempt.tracked;
            const connectionEntries = attempt.connections;

            // A record the attempt did not touch is gone from the render: release its
            // subscription and drop the record. A connection the attempt did not touch keeps
            // its declaration but loses its committed description — and with it, below, the
            // subscription: an unused connection must have no active read subscription. An
            // absent map reads exactly like an empty one: nothing was touched.
            this.tracked?.forEach((slot: ITrackedCarburetor, source: ICarburetorSubscription) => {
                if (trackedEntries !== undefined && trackedEntries.has(source)) {
                    return;
                }

                this.releaseSlot(this.uid, slot);
                this.tracked?.delete(source);
            });

            this.connections.forEach((connection: IConnection) => {
                if (connectionEntries === undefined || !connectionEntries.has(connection)) {
                    connection.committed = undefined;
                }
            });

            // The attempt's read sets become the committed descriptions as-is: recorders write
            // only while their attempt is open, and it has closed by now. A source still
            // tracked from the previous commit keeps its slot object, and a slot that already
            // has a description keeps that object too — both are updated in place rather than
            // replaced, since nothing outside this method holds either past a single commit.
            if (trackedEntries !== undefined) {
                trackedEntries.forEach((entry: IAttemptEntry, source: ICarburetorSubscription) => {
                    const existing = this.tracked?.get(source);

                    if (existing) {
                        this.applyDescription(existing, entry);
                    } else {
                        this.ensureTracked().set(source, {
                            committed: this.buildDescription(entry),
                            installed: undefined,
                        });
                    }
                });
            }

            if (connectionEntries !== undefined) {
                connectionEntries.forEach((entry: IAttemptEntry, connection: IConnection) => {
                    this.applyDescription(connection, entry);
                });
            }

            // From here on only identity matters — a replayed commit re-aligns from the
            // descriptions just published above, never from the attempt itself — and
            // `deferredLoads`, which `loadStaleResources` drains right after this returns.
            // Releasing the rest here, rather than waiting for the attempt to be replaced by a
            // future render, is what keeps a retained `pendingAttempt`/`committedAttempt` from
            // holding this render's dependency maps alive indefinitely.
            attempt.tracked = undefined;
            attempt.connections = undefined;
            attempt.sources = undefined;
        }

        let changedDuringRender = false;

        this.tracked?.forEach((slot: ITrackedCarburetor) => {
            if (this.alignSubscription(this.uid, slot)) {
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
     * Returns the tracked map, allocating it on first use.
     *
     * A `connect()`-only component never calls `useCarburetor`/`useComputed`/`useResource`, so
     * it never needs this map; allocating it here, rather than as a class field default, keeps
     * that component from paying for a collection it will never fill.
     */
    private ensureTracked(): Map<ICarburetorSubscription, ITrackedCarburetor> {
        if (this.tracked === undefined) {
            this.tracked = new Map();
        }

        return this.tracked;
    }

    /**
     * Builds a fresh committed description out of one attempt entry.
     *
     * @param entry - the attempt's record for the source being committed
     */
    private buildDescription(entry: IAttemptEntry): IDependencyDescription {
        return {carburetor: entry.source, baselineVersion: entry.baselineVersion, reads: entry.reads};
    }

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
    private applyDescription(slot: IDependencySlot, entry: IAttemptEntry): void {
        const description = slot.committed;

        if (description) {
            description.carburetor = entry.source;
            description.baselineVersion = entry.baselineVersion;
            description.reads = entry.reads;
        } else {
            slot.committed = this.buildDescription(entry);
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
            // Shared: committed.reads is immutable, and subscribe() keeps its own copy.
            slot.installed = {carburetor: committed.carburetor, reads: committed.reads};
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
        this.tracked?.forEach((slot: ITrackedCarburetor) => {
            this.releaseSlot(this.uid, slot);
        });

        this.connections.forEach((connection: IConnection) => {
            this.releaseSlot(connection.uid, connection);
        });

        this.renderAttempt = undefined;
    }
}
