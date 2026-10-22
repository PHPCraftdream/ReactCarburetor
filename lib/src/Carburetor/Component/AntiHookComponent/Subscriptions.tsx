"use client";

import {C} from "../Models/ComponentSymbols";

import {transferCompletedReads} from "../../Store/Tracking/Observation/transferCompletedReads";
import {sameReads} from "../../Store/Tracking/Observation/sameReads";
import {ICarburetorSubscription} from "../../Models/Store";
import {TCompletedReads} from "../../Store/Tracking/Observation/Models";
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from "../../Store/Utils/Models";
import {getComputedSnapshotVersion} from "../../Derived/Freshness/getComputedSnapshotVersion";
import {
    IAttemptEntry,
    IConnection,
    IDependencyDescription,
    IDependencySlot,
    ITrackedCarburetor,
} from "../Models/Connection";
import {AntiHookComponentEffects} from "./Effects";
import {diagnostics} from '../../Store/Diagnostics/DiagnosticsInstance';
declare const process: {env: {NODE_ENV?: string}};

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
    public [C.onCarburetorUpdate] = (): void => {
        this.forceUpdate();
    };

    /**
     * Establishes this commit's subscriptions and drops the ones this render no longer needs.
     *
     * A commit consumes the pending render attempt exactly once, and only a fresh one: a fresh
     * attempt's entries become each dependency's committed description with their now-closed
     * read sets transferred by reference. Records the attempt never touched are released and
     * deleted, and a connection it never touched loses its description, which `alignSubscription`
     * turns into an unsubscribe. A
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
    public [C.commitSubscriptions](): void {
        const attempt = this[C.pendingAttempt];

        // A commit consumes a render attempt exactly once, and only a fresh one: StrictMode's
        // replayed mount and a Suspense hide/reveal commit again with NO new render behind
        // them — identity with the last consumed attempt is what tells those apart from a
        // real render, so a replay restores the last committed description instead of being
        // mistaken for an empty render.
        const fresh = attempt !== undefined && !attempt.abandoned && attempt !== this[C.committedAttempt];

        if (fresh) {
            this[C.committedAttempt] = attempt;
            if (process.env.NODE_ENV !== 'production') {
                const ctor = this.constructor as typeof this.constructor & {displayName?: string};
                diagnostics.registerComponent(this, ctor.displayName ?? ctor.name, this[C.onCarburetorUpdate]);
            }
            const trackedEntries = attempt.tracked;
            const touchedConnections = attempt.connections;

            // A record the attempt did not touch is gone from the render: release its
            // subscription and drop the record. A connection the attempt did not touch keeps
            // its declaration but loses its committed description — and with it, below, the
            // subscription: an unused connection must have no active read subscription. An
            // absent collection reads exactly like an empty one: nothing was touched.
            if (this[C.tracked] !== undefined) {
                for (const [source, slot] of this[C.tracked]!) {
                    if (trackedEntries !== undefined && trackedEntries.has(source)) {
                        continue;
                    }

                    this[C.releaseSlot](this[C.uid], slot);
                    this[C.tracked]!.delete(source);
                }
            }

            for (const connection of this[C.connections]) {
                // Touched this attempt only when the tag matches AND an entry was actually
                // recorded: resolving the source alone (an `ownKeys`/`has` probe with no path
                // read) tags the connection but never builds an entry, exactly like the old
                // per-attempt map, which only ever gained one from a recorded read.
                if (connection.attemptTag === attempt && connection.attemptEntry !== undefined) {
                    continue;
                }

                connection.committed = undefined;
                // Dropped rather than left stale: an unread connection must not keep pinning
                // last attempt's resolved source and read set alive indefinitely.
                connection.attemptTag = undefined;
                connection.attemptSource = undefined;
                connection.attemptEntry = undefined;
            }

            // The attempt's read sets become the committed descriptions as-is: recorders write
            // only while their attempt is open, and it has closed by now. A source still
            // tracked from the previous commit keeps its slot object, and a slot that already
            // has a description keeps that object too — both are updated in place rather than
            // replaced, since nothing outside this method holds either past a single commit.
            if (trackedEntries !== undefined) {
                for (const [source, entry] of trackedEntries) {
                    const existing = this[C.tracked]?.get(source);

                    if (existing) {
                        this[C.applyDescription](existing, entry);
                    } else {
                        const committed = this[C.buildDescription](entry);
                        this[C.ensureTracked]().set(source, {committed, installed: undefined});
                    }
                }
            }

            if (touchedConnections !== undefined) {
                if (process.env.NODE_ENV !== 'production') {
                    const ctor = this.constructor as typeof this.constructor & {displayName?: string};
                    const name = ctor.displayName ?? ctor.name;
                    for (const connection of touchedConnections) {
                        if (connection.wake !== undefined) {
                            diagnostics.registerComponent(this, name, connection.wake);
                        }
                    }
                }
                for (const connection of touchedConnections) {
                    const entry = connection.attemptEntry;
                    if (entry !== undefined) {
                        this[C.applyDescription](connection, entry);
                    }
                }
            }

            if (process.env.NODE_ENV !== 'production' && diagnostics.isEnabled()
                && diagnostics.getWideReadThreshold() !== Infinity) {
                // One warning per component and store per commit, over the union of the read
                // paths of every committed slot of that store; a single slot is counted as is.
                const wideReads = new Map<string, {source: object; paths: ReadonlySet<unknown>}>();
                /** Adds one committed slot's reads to its store's union.
                 *
                 * @param slot - a tracked slot or connection of this component
                 */
                const accumulate = (slot: IDependencySlot): void => {
                    const committed = slot.committed;
                    if (committed === undefined) return;
                    const uid = committed.carburetor.getUID();
                    const entry = wideReads.get(uid);
                    if (entry === undefined) {
                        wideReads.set(uid, {source: committed.carburetor as object, paths: committed.reads});
                    } else if (entry.paths !== committed.reads) {
                        const union = new Set<unknown>(entry.paths);
                        committed.reads.forEach((path: unknown) => union.add(path));
                        entry.paths = union;
                    }
                };
                this[C.tracked]?.forEach(accumulate);
                for (const connection of this[C.connections]) accumulate(connection);
                for (const [uid, {source, paths}] of wideReads) {
                    diagnostics.reportWideRead(this, source, uid, paths.size);
                }
            }

            // From here on only identity matters — a replayed commit re-aligns from the
            // descriptions just published above, never from the attempt itself — and
            // `deferredLoads`, which `loadStaleResources` drains right after this returns.
            // Releasing the rest here, rather than waiting for the attempt to be replaced by a
            // future render, is what keeps a retained `pendingAttempt`/`committedAttempt` from
            // holding this render's dependency maps alive indefinitely.
            attempt.tracked = undefined;
            attempt.connections = undefined;
        }

        let changedDuringRender = false;

        if (this[C.tracked] !== undefined) {
            for (const slot of this[C.tracked]!.values()) {
                if (this[C.alignSubscription](this[C.uid], slot)) {
                    changedDuringRender = true;
                }
            }
        }

        for (const connection of this[C.connections]) {
            if (this[C.alignSubscription](connection.uid, connection)) {
                changedDuringRender = true;
            }
        }

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
    private [C.ensureTracked](): Map<ICarburetorSubscription, ITrackedCarburetor> {
        if (this[C.tracked] === undefined) {
            this[C.tracked] = new Map();
        }

        return this[C.tracked]!;
    }

    /**
     * Builds a fresh committed description out of one attempt entry.
     *
     * @param entry - the attempt's record for the source being committed
     * @param slot - the slot receiving the description, absent for a slot this commit creates
     */
    private [C.buildDescription](entry: IAttemptEntry, slot?: IDependencySlot): IDependencyDescription {
        return {
            resourcePaths: entry.resourcePaths,
            targetsWanted: entry.targetsWanted,
            carburetor: entry.source, baselineVersion: entry.baselineVersion,
            reads: entry.complete(slot, false),
        };
    }

    /**
     * Publishes one attempt entry onto a slot's committed description, reusing the existing
     * description object when there is one instead of allocating a fresh one every commit.
     *
     * Description identity survives commits. Deferred resource adoption pairs it with the
     * render-attempt and registration guards before publishing closed reads.
     *
     * @param slot - the tracked slot or connection being committed
     * @param entry - the attempt's record for the source being committed
     */
    private [C.applyDescription](slot: IDependencySlot, entry: IAttemptEntry): void {
        const description = slot.committed;
        if (slot.resourceLoads !== undefined) {
            for (const path of slot.resourceLoads.keys()) {
                if (!entry.resourcePaths?.has(path)) slot.resourceLoads.delete(path);
            }
        }

        if (description) {
            description.resourcePaths = entry.resourcePaths;
            description.targetsWanted = entry.targetsWanted;
            description.carburetor = entry.source;
            description.baselineVersion = entry.baselineVersion;
            description.reads = entry.complete(slot, true);
        } else {
            slot.committed = this[C.buildDescription](entry, slot);
        }
    }

    /**
     * Migrates closed reads for an equal snapshot without rendering (R37-06).
     * The notify pass's generation guard prevents redelivery of the current write.
     *
     * @param connection - the selection connection being migrated
     * @param reads - the closed read set the notification-time selector run collected
     * @param version - the source version the equal snapshot was verified at
     */
    public [C.migrateConnectionReads](connection: IConnection, reads: TCompletedReads, version: number): void {
        const committed = connection.committed;

        if (!committed) {
            return;
        }

        if (connection.installed && connection.installed.carburetor !== committed.carburetor) {
            connection.installed.carburetor.unsubscribe(connection.uid);
            connection.installed = undefined;
        }

        if (connection.installed === undefined || !sameReads(connection.installed.reads, reads)) {
            committed.carburetor.subscribe(
                connection.wake ?? this[C.onCarburetorUpdate], transferCompletedReads(reads, connection.uid)
            );
            connection.installed = {carburetor: committed.carburetor, reads};
        } else if (connection.installed.reads !== reads) {
            reads = connection.installed.reads as TCompletedReads;
        }

        committed.reads = reads;
        committed.baselineVersion = version;
    }

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
     * ancestor, a written descendant. A source with no such log (the internal drift symbol
     * absent, e.g. a computed, which invalidates at the granularity of its whole value) keeps
     * today's coarser answer: any version change is a drift.
     *
     * @param uid - the id the slot's registration is keyed under: the component's own for
     * `tracked` records, the connection's own for connections
     * @param slot - the slot to align
     */
    private [C.alignSubscription](uid: string, slot: IDependencySlot): boolean {
        const committed = slot.committed;
        const installed = slot.installed;

        if (!committed) {
            if (installed) {
                installed.carburetor.unsubscribe(uid);
                slot.installed = undefined;
            }
            slot.targets?.sync(undefined);

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
            // Reuses the slot's id and transfers the attempt's now-closed Set directly into the
            // subscriber index; the selection/comparison/detachment work finished before render closed.
            committed.carburetor.subscribe(
                slot.wake ?? this[C.onCarburetorUpdate], transferCompletedReads(committed.reads, uid)
            );
            slot.installed = {carburetor: committed.carburetor, reads: committed.reads};
        } else if (slot.installed.reads !== committed.reads) {
            // Adopt the filed set: the drift answer below is O(1) only for that identity.
            slot.ledger?.adopt(committed.reads, slot.installed.reads);
            committed.reads = slot.installed.reads;
        }

        // R39-04: one owner per slot and source, held while the slot is committed and subscribed.
        if (slot.targets !== undefined) {
            slot.targets.sync(committed.targetsWanted ? committed.carburetor : undefined);
        }

        const {carburetor, baselineVersion, reads} = committed;
        const version = getComputedSnapshotVersion(carburetor);

        if (version === baselineVersion) {
            return false;
        }

        const hasDrift = (carburetor as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT];

        return hasDrift === undefined || hasDrift.call(carburetor, baselineVersion, reads);
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
    private [C.releaseSlot](uid: string, slot: IDependencySlot): void {
        slot.resourceLoads = undefined;
        if (slot.installed) {
            slot.installed.carburetor.unsubscribe(uid);
            slot.installed = undefined;
        }
        slot.targets?.sync(undefined);
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
    public [C.releaseSubscriptions](): void {
        this[C.tracked]?.forEach((slot: ITrackedCarburetor) => {
            this[C.releaseSlot](this[C.uid], slot);
        });

        this[C.connections].forEach((connection: IConnection) => {
            this[C.releaseSlot](connection.uid, connection);
        });

        this[C.renderAttempt] = undefined;
    }
}
