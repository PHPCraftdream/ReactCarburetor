import {IDict, TSubscriber} from "@/Carburetor/Models/Base";
import {IComputed, TComputeBody, TComputedReader} from "@/Carburetor/Models/Derived";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetor, ICarburetorSubscription, ISubscribeOptions} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {isExoticValue} from "@/Carburetor/Store/Utils/isExoticValue";
import {updateWave} from "@/Carburetor/Store/Scheduling/UpdateWaveInstance";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/**
 * Maps a live computed's invalidation callback to the call that marks that computed's
 * cached value stale. Invalidation travels downstream along these edges — and only
 * these: a plain value observer is woken by a delivered change, never by a mark.
 */
const invalidationEdges: WeakMap<TSubscriber, () => void> = new WeakMap<TSubscriber, () => void>();

interface IDependency {
    source: ICarburetorSubscription;
    reads: TPathSet;
}

/** One store a value was computed from, and the version it held at the time. */
interface IDependencyVersion {
    source: ICarburetorSubscription;
    version: number;
}

/** The value the last notification carried, and the dependency versions it was read from. */
interface IAnnouncement<R> {
    value: R;
    versions: IDict<IDependencyVersion>;
}

/**
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export class Computed<R> implements IComputed<R> {
    /** This computed's id, which dependencies are subscribed and released under. */
    protected uid: string = getUid();
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    protected version: number = 0;
    /** Callbacks woken when a changed value settles, keyed by subscription id. */
    protected subscribers: IDict<TSubscriber> = {};
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency> = {};

    /** The stores the current value was computed from, including those behind inner computeds. */
    protected versions: IDict<IDependencyVersion> = {};

    /**
     * The value an observer last had delivered: the baseline a settlement is judged
     * against, kept independently of the evaluation cache.
     *
     * It is set when the first subscriber arrives — the moment somebody starts actually
     * looking at the value — so a read that refreshes the cache mid-wave can never move
     * the baseline. Undefined while nobody has been told anything.
     */
    protected announced: IAnnouncement<R> | undefined = undefined;

    /** The cached body result, undefined until the first compute. */
    protected value: R | undefined = undefined;
    /** Whether the cached value can be trusted; cleared when a dependency moves or the last listener leaves. */
    protected valid: boolean = false;

    /** Takes the body whose reads become this value's dependencies. */
    constructor(protected body: TComputeBody<R>) {
        // Files this computed's invalidation callback so computations upstream of it can
        // reach it when they are invalidated — including when their settlement fails and
        // nothing is announced.
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
    }

    /** The identity a component or another computed subscribes by. */
    public getUID = (): string => {
        return this.uid;
    };

    /** Bumped once per delivered change, not on every recompute. */
    public getVersion = (): number => {
        return this.version;
    };

    /** The value, recomputing first if it cannot be trusted. */
    public get = (): R => {
        if (this.isStale()) {
            this.recompute();
        }

        return this.value as R;
    };

    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     *
     * @param callback - woken only when a settled value differs from the last announced one
     * @param options - `id` keys the subscription for later unsubscribe; a uid is generated when omitted
     */
    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        const id = options.id || getUid();
        const wasUnobserved = Object.keys(this.subscribers).length === 0;

        this.subscribers[id] = callback;

        // A value nobody reads is not worth keeping fresh, so dependencies are only observed
        // once someone is listening. While unobserved the computed misses every write, so
        // observation starts with a freshness check: the cached value survives only when the
        // stores it was computed from have not moved since. The check is `hasDrifted` rather
        // than `isStale` because the subscriber above already made this computed observed.
        if (!this.valid || (wasUnobserved && this.hasDrifted())) {
            this.recompute();
        } else if (wasUnobserved) {
            this.observeDependencies();
        }

        // First observation is the moment the value becomes a publication: whoever just
        // subscribed is looking at exactly this value, so it is the baseline the first
        // settlement is judged against. A body that just threw leaves the baseline alone —
        // there is nothing successful to be told about yet.
        if (wasUnobserved && this.valid) {
            this.announced = {value: this.value as R, versions: {...this.versions}};
        }

        return id;
    };

    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
    public unsubscribe = (id: string) => {
        if (!(id in this.subscribers)) {
            return;
        }

        delete this.subscribers[id];

        if (Object.keys(this.subscribers).length === 0) {
            this.releaseDependencies();
            this.valid = false;
        }
    };

    /** Whether the cached value can still be handed out. */
    protected isStale = (): boolean => {
        // Observed, invalidations arrive through the subscription, so `valid` is authoritative.
        if (Object.keys(this.subscribers).length > 0) {
            return !this.valid;
        }

        return !this.valid || this.hasDrifted();
    };

    /** Whether any store this value was computed from moved since it was read. */
    protected hasDrifted = (): boolean => {
        return Object.keys(this.versions).some((cuid: string) => {
            const recorded = this.versions[cuid];

            return recorded.source.getVersion() !== recorded.version;
        });
    };

    /**
     * Whether any dependency moved since the given version snapshot was taken.
     *
     * @param record - the versions captured at an earlier moment, e.g. alongside an announcement
     */
    protected driftedSince = (record: IDict<IDependencyVersion>): boolean => {
        const moved = Object.keys(record).some((cuid: string) => {
            const recorded = record[cuid];

            return recorded.source.getVersion() !== recorded.version;
        });

        if (moved) {
            return true;
        }

        // A body that now reads a store the snapshot never saw has changed inputs too.
        return Object.keys(this.versions).some((cuid: string) => !(cuid in record));
    };

    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute = (): void => {
        const collected: IDict<IDependency> = {};

        const track = (source: ICarburetor<object> | IComputed<unknown>): unknown => {
            const cuid = source.getUID();
            const dependency = collected[cuid] || {source, reads: new Set<TPath>()};

            collected[cuid] = dependency;

            if ('read' in source) {
                return source.read((path: TPath) => {
                    this.recordDependencyRead(dependency, path);
                });
            }

            // Another computed notifies at the granularity of its whole value,
            // so there is no finer path to depend on than "it changed".
            dependency.reads.add(WILDCARD_PATH);

            return source.get();
        };

        this.value = this.body(track as TComputedReader);
        this.valid = true;

        this.attachDependencies(collected);
    };

    /**
     * Records one path read through a dependency, amending an established registration
     * when the read arrives after the body's own evaluation.
     *
     * The value a computed hands out stays live: a consumer reading a deeper leaf off it
     * re-enters the read proxy the value was built from, whose recorder reports here long
     * after attachDependencies published the read set. The store copied that set at
     * subscription time, so the mutation alone reaches no registration — while the leaf is
     * exactly what that consumer renders from, and a write to it must wake this computed.
     * Re-subscribing the dependency under this computed's own id replaces the registration
     * with the amended set, the same way a fresh edge is published.
     *
     * During the body's own evaluation the dependency being filled is not yet the published
     * one (attachDependencies swaps it in after the body returns), so nothing is amended
     * there; once nobody listens there is no registration to amend either.
     *
     * @param dependency - the dependency edge the read belongs to
     * @param path - the path the read proxy reported
     */
    protected recordDependencyRead = (dependency: IDependency, path: TPath): void => {
        if (dependency.reads.has(path)) {
            return;
        }

        dependency.reads.add(path);

        const published = dependency === this.dependencies[dependency.source.getUID()];
        const observed = Object.keys(this.subscribers).length > 0;

        if (published && observed) {
            dependency.source.subscribe(this.onDependencyChanged, {id: this.uid, reads: dependency.reads});
        }
    };

    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies = (collected: IDict<IDependency>): void => {
        // Only registrations the fresh collection does not already hold need work: kept
        // edges stay subscribed under the same id and read set, departed edges are
        // dropped, new or changed edges are subscribed below. Releasing a retained edge
        // instead would unsubscribe an upstream computed, whose last-subscriber release
        // invalidates it and drags the whole upstream chain through an eager recompute
        // mid-wave — work no settlement deduplicates, because it is not a settlement.
        const fresh = this.diffDependencies(collected);

        this.dependencies = collected;
        this.recordVersions(collected);

        // Dependencies are only observed while somebody is listening to the computed.
        if (Object.keys(this.subscribers).length === 0) {
            return;
        }

        Object.keys(collected).forEach((cuid: string) => {
            if (!fresh[cuid]) {
                return;
            }

            const dependency = collected[cuid];

            dependency.source.subscribe(this.onDependencyChanged, {id: this.uid, reads: dependency.reads});
        });
    };

    /**
     * Splits a fresh collection into edges already held and edges needing a registration.
     *
     * A kept edge survives with its live subscription untouched — same source, same read
     * set, same subscription id — so recomputing while observed never churns the upstream
     * subscriber list. Sources the body no longer reads are unsubscribed; a source still
     * read through different paths is reported as fresh, and the caller's subscribe
     * replaces that registration in place.
     *
     * @param collected - the dependencies the body just collected, compared against the held set
     * @returns the collected ids that still need a subscription: new sources, and sources
     * now read through different paths
     */
    protected diffDependencies = (collected: IDict<IDependency>): IDict<boolean> => {
        const fresh: IDict<boolean> = {};

        Object.keys(this.dependencies).forEach((cuid: string) => {
            const next = collected[cuid];

            if (!next) {
                this.dependencies[cuid].source.unsubscribe(this.uid);

                return;
            }

            if (!this.sameReads(this.dependencies[cuid].reads, next.reads)) {
                fresh[cuid] = true;
            }
        });

        Object.keys(collected).forEach((cuid: string) => {
            if (!(cuid in this.dependencies)) {
                fresh[cuid] = true;
            }
        });

        return fresh;
    };

    /**
     * Whether two read sets name exactly the same paths.
     *
     * @param before - the paths an edge is currently registered under
     * @param after - the paths the fresh collection recorded for the same source
     * @returns true when both sets hold the same paths, so the registration can stay
     */
    protected sameReads = (before: TPathSet, after: TPathSet): boolean => {
        if (before === after) {
            return true;
        }

        if (before.size !== after.size) {
            return false;
        }

        let same = true;

        before.forEach((path: TPath) => {
            if (!after.has(path)) {
                same = false;
            }
        });

        return same;
    };

    /**
     * Records the store versions the value was computed from. An inner computed hides the
     * stores behind it, so those are recorded in its place — otherwise a write they saw
     * while nobody was listening could never be noticed here.
     *
     * The body has just read every dependency, so their own records are current.
     */
    protected recordVersions = (collected: IDict<IDependency>): void => {
        const versions: IDict<IDependencyVersion> = {};

        const record = (dependency: IDependency): void => {
            if ('read' in dependency.source) {
                versions[dependency.source.getUID()] = {
                    source: dependency.source,
                    version: dependency.source.getVersion(),
                };

                return;
            }

            const inner = dependency.source as Computed<unknown>;

            Object.keys(inner.versions).forEach((cuid: string) => {
                versions[cuid] = inner.versions[cuid];
            });
        };

        Object.keys(collected).forEach((cuid: string) => {
            record(collected[cuid]);
        });

        this.versions = versions;
    };

    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            const dependency = this.dependencies[cuid];

            dependency.source.subscribe(this.onDependencyChanged, {id: this.uid, reads: dependency.reads});
        });
    };

    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });

        this.dependencies = {};
    };

    /** Invalidates on a dependency write, and settles once the wave around it has passed. */
    protected onDependencyChanged = (): void => {
        // An upstream announcement can arrive after something else already pulled this
        // value fresh — an eager get() during a sibling's settlement, for instance. Once
        // recomputed, this value's own recorded versions bottom out at the same raw stores
        // the announcement traces back to, so a clean hasDrifted() here means the pull
        // already saw everything this notification is reporting: nothing to act on.
        if (this.valid && !this.hasDrifted()) {
            return;
        }

        // Invalidation travels before any settlement runs: everything downstream is marked
        // stale now, so a settlement that pulls a dependent's cached value recomputes it
        // from current inputs instead of combining a new input with a stale derived one.
        this.markStale();

        // One write reaches this computed's dependencies one after another inside the same
        // pass. Settling for each notification would announce values built from inputs that
        // have not been told about the write yet — and recomputing mid-pass resubscribes the
        // dependency set, which can even consume an input's own invalidation. The wave
        // decides when it is this computed's turn: once, with every input already settled.
        if (updateWave.isActive()) {
            updateWave.defer(this.uid, this.settle);

            return;
        }

        this.settle();
    };

    /**
     * Marks this cached value untrustworthy and passes the mark downstream.
     *
     * The mark stops at value observers on purpose: they are woken when a changed value
     * is delivered, and a mark must not wake them into reading a computation that is
     * still mid-flight. Computed subscribers, however, must learn about the invalidation
     * even when no settlement of theirs follows — when the settlement upstream fails, no
     * announcement ever comes, and an unmarked dependent would keep serving its cached
     * value as if it were still current.
     */
    protected markStale = (): void => {
        this.valid = false;

        Object.keys(this.subscribers).forEach((id: string) => {
            const callback = this.subscribers[id];

            if (!callback) {
                return;
            }

            const mark = invalidationEdges.get(callback);

            if (mark) {
                mark();
            }
        });
    };

    /**
     * Recomputes and wakes subscribers if the value moved past what was last announced.
     *
     * A body that throws changes nothing here: the value, `valid` and `announced` stand
     * untouched, so no old cached value can be announced as a newly successful computation.
     * The error escapes to the wave, which isolates it and keeps settling the other
     * computations; an explicit get() reruns the body and hands the error to its reader,
     * and the next write to a dependency retries it.
     */
    protected settle = (): void => {
        const previous = this.value;

        // A settlement queued while this value was stale can find it already valid by the
        // time its turn comes: an eager get() elsewhere in the wave — pulled by another
        // node's own settlement — already reran the body against the same upstream state
        // this settlement was deferred to wait for. Recomputing again would just repeat
        // that call for no new input.
        if (!this.valid || this.hasDrifted()) {
            this.recompute();
        }

        // The judgment is against the publication baseline, not `previous`: a read that
        // landed mid-wave can have refreshed the cache without the observer ever seeing
        // the intermediate value, so what was last ANNOUNCED is what a change is measured
        // from. `announced` is undefined only when observation never produced a
        // successful value, and then the last cached value is all there is to compare with.
        const baseline = this.announced !== undefined ? this.announced.value : previous;

        // An exotic result is judged by its dependencies, not its reference (R6-02): the same
        // Map can have been mutated in place since it was announced, so Object.is alone would
        // suppress a notification the dependency genuinely earned. Plain results keep the
        // reference check by itself.
        const moved = this.announced !== undefined && this.driftedSince(this.announced.versions);
        const unchanged = Object.is(baseline, this.value) && !(isExoticValue(this.value) && moved);

        if (unchanged) {
            return;
        }

        this.announced = {value: this.value as R, versions: {...this.versions}};
        this.version++;
        this.deliver();
    };

    /**
     * Wakes every subscriber with the settled value.
     *
     * Each subscriber is isolated, matching notifyWrites(): one that throws costs the
     * subscribers after it neither their notification nor the wave its remaining work, and
     * the failures are reported once delivery finishes rather than re-thrown.
     */
    protected deliver = (): void => {
        const failures: unknown[] = [];

        Object.keys(this.subscribers).forEach((id: string) => {
            // A subscriber may have left while this very batch was being delivered.
            const callback = this.subscribers[id];

            if (callback) {
                try {
                    callback();
                } catch (error: unknown) {
                    failures.push(error);
                }
            }
        });

        failures.forEach((error: unknown) => {
            if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                diagnostics.report(
                    'a subscriber threw while a computed value was delivered: ' +
                    (error instanceof Error ? error.message : String(error)) +
                    '. The remaining subscribers were notified anyway.'
                );
            }
        });
    };
}
