import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PROXY_CACHE} from "@/Carburetor/Store/Tracking/Models";
import {
    IAttemptEntry,
    IConnection,
    IDependencyDescription,
    IDependencySlot,
} from "@/Carburetor/Component/Models/Connection";
import {AntiHookComponentEffects} from "./Effects";

const CONNECTION_ATTEMPT_KEY = "c:";
const TRACKED_ATTEMPT_KEY = "t:";
const describeFailure = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error));

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

    /**
     * Drops every connect()/connectSelection() view's watcher slot from its store's shared
     * invalidation scope, so an unmounted component stops being scanned on the next write or
     * cache construction there instead of waiting on garbage collection (R3-07).
     *
     * Read from `this.connections`, not a separately populated/cleared list: a connection's
     * declaration is never pruned, so its `view` reference survives a StrictMode-replayed
     * componentWillUnmount/componentDidMount pair intact, and a real unmount later still finds
     * whichever facade the persistent declaration currently owns — even one built after a root
     * replacement that happened between the replay and the real unmount (R4-05). A list
     * populated once by connect()/connectSelection() and unconditionally emptied here on every
     * unmount, replay included, had nothing to repopulate it before that later real unmount.
     *
     * `PROXY_CACHE` is a peek, not a read (R4-09): a declaration never actually read during
     * this component's life has no cache built for it, and the facade answers `undefined`
     * instead of resolving the source and minting one from scratch just to release it here.
     *
     * Each view is released in isolation, the same way `releaseEffects` isolates each cleanup:
     * one view whose source can no longer be resolved must not cost the views after it their
     * release.
     */
    protected releaseConnectionViews(): void {
        const failures: unknown[] = [];

        this.connections.forEach((connection: IConnection) => {
            const view = connection.view;

            if (view === undefined) {
                return;
            }

            try {
                const cache = (view as {[PROXY_CACHE]?: {release?: () => void}})[PROXY_CACHE];

                cache?.release?.();
            } catch (error: unknown) {
                failures.push(error);
            }
        });

        failures.forEach((error: unknown) => this.reportTeardownFailure(
            "releasing a connect() view's cache threw while a component unmounted: " +
            describeFailure(error) + '. The teardown completed anyway.'
        ));
    }
}
