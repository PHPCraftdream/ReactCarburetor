import {TPath, TPathSet} from "../../../Models/Paths";
import {completeReads} from "../../Tracking/Observation/completeReads";
import {TCompletedReads} from "../../Tracking/Observation/Models";

/** The recording a ledger is counting; it copies its counted paths out before another one starts. */
type TLedgerOwner = {spill(): unknown};

/**
 * One slot's last committed raw recording, kept so an identical later recording can adopt the
 * closed set it completed to instead of building, pruning and comparing a fresh one.
 *
 * Keys are the raw paths, unpruned; each value is the epoch of the recording that last read it, so
 * counting distinct hits allocates nothing. Only one recording counts at a time: a new claim
 * spills the previous owner first, so no two recordings ever share a stamp table. `open`,
 * `record` and `close` run one synchronous recording owned by the ledger itself.
 */
export class ReadLedger {
    /** Raw paths of the learned recording, each stamped with the epoch that last read it. */
    private stamps: Map<TPath, number> | undefined = undefined;
    /** The stamp of the recording counted now. */
    private epoch = 0;
    /** Distinct learned paths the counted recording has read. */
    private hits = 0;
    /** The recording counted now, if any. */
    private owner: TLedgerOwner | undefined = undefined;
    /** The closed set the learned recording completed to. */
    private filed: TCompletedReads | undefined = undefined;
    /** The filed set's size when learned; a grown set no longer matches. */
    private filedSize = 0;
    /** The store the learned recording read. */
    private source: unknown = undefined;
    /** The ledger's own recording once copied out. */
    private raw: TPathSet | undefined = undefined;
    /** The store the own recording reads. */
    private reading: unknown = undefined;

    /**
     * Starts counting a recording when the learned set is exactly the registered one.
     *
     * @param owner - the recording that will report its paths through `hit`
     * @param source - the store the recording reads
     * @param installed - the read set registered for the slot right now
     */
    public claim(owner: TLedgerOwner, source: unknown, installed: ReadonlySet<TPath> | undefined): boolean {
        const filed = this.filed;
        if (filed === undefined || filed !== installed || this.source !== source || filed.size !== this.filedSize) {
            return false;
        }
        this.owner?.spill();
        this.owner = owner;
        this.epoch++;
        this.hits = 0;
        return true;
    }

    /**
     * Counts one path of the owning recording; false for a path the learned recording lacks.
     *
     * @param path - the path just read
     */
    public hit(path: TPath): boolean {
        const stamps = this.stamps!;
        const stamp = stamps.get(path);
        if (stamp === undefined) return false;
        if (stamp !== this.epoch) {
            stamps.set(path, this.epoch);
            this.hits++;
        }
        return true;
    }

    /** Copies the owner's counted paths into a fresh raw set and ends its count. */
    public release(): TPathSet {
        const raw = new Set<TPath>();
        for (const [path, stamp] of this.stamps!) if (stamp === this.epoch) raw.add(path);
        this.owner = undefined;
        return raw;
    }

    /** The learned closed set when the owner read exactly the learned paths; ends the count then. */
    public settle(): TCompletedReads | undefined {
        const filed = this.filed;
        if (filed === undefined || this.hits !== this.stamps!.size || filed.size !== this.filedSize) return undefined;
        this.owner = undefined;
        return filed;
    }

    /**
     * Learns a raw recording, then closes it in place: the closed set becomes the learned one.
     *
     * @param raw - the committed recording, not yet pruned
     * @param source - the store it read
     */
    public learn(raw: TPathSet, source: unknown): TCompletedReads {
        // The owner copies its counted paths out before the stamps change.
        this.owner?.spill();
        this.owner = undefined;
        const epoch = ++this.epoch;
        const stamps = this.stamps ??= new Map<TPath, number>();
        for (const path of raw) stamps.set(path, epoch);
        if (stamps.size !== raw.size) {
            for (const [path, stamp] of stamps) if (stamp !== epoch) stamps.delete(path);
        }
        const filed = completeReads(raw);
        this.source = source;
        this.filed = filed;
        this.filedSize = filed.size;
        return filed;
    }

    /**
     * Follows a commit that swapped the learned set for the content-equal registered one.
     *
     * @param previous - the set the commit published
     * @param next - the registered set it adopted instead
     */
    public adopt(previous: ReadonlySet<TPath>, next: TCompletedReads): void {
        if (this.filed !== previous) return;
        this.filed = next;
        this.filedSize = next.size;
    }

    /**
     * Opens the ledger's own recording, dropping an unfinished earlier one; false when it cannot
     * match the learned recording, and the caller then hands `begin` the set to record into.
     *
     * @param source - the store the recording reads
     * @param installed - the read set registered right now
     */
    public open(source: unknown, installed: ReadonlySet<TPath> | undefined): boolean {
        if (this.owner === this) this.owner = undefined;
        this.reading = source;
        this.raw = undefined;
        return this.claim(this, source, installed);
    }

    /**
     * Records the own recording into a caller-built set.
     *
     * @param raw - the empty set to record into
     */
    public begin(raw: TPathSet): void {
        this.raw = raw;
    }

    /**
     * Records one path of the ledger's own recording.
     *
     * @param path - the path a read touched
     */
    public record(path: TPath): void {
        if (this.raw === undefined && this.owner === this && this.hit(path)) return;
        this.spill().add(path);
    }

    /** The own recording's paths so far, copied out of the stamps on first use. */
    public spill(): TPathSet {
        if (this.raw === undefined) this.raw = this.owner === this ? this.release() : new Set<TPath>();
        return this.raw;
    }

    /**
     * Whether every path recorded so far is covered by `filed`: true while the own recording
     * matched the learned one path by path and `filed` is the learned closed set.
     *
     * @param filed - the closed set the caller holds
     */
    public covered(filed: ReadonlySet<TPath>): boolean {
        return this.raw === undefined && this.owner === this && this.filed === filed
            && filed.size === this.filedSize;
    }

    /** Drops the own recording without learning it. */
    public abandon(): void {
        if (this.owner === this) this.owner = undefined;
        this.raw = undefined;
    }

    /**
     * Closes the own recording: the learned set when it matched exactly, otherwise its completed
     * paths, learned when `learn` is set or a baseline already exists.
     *
     * @param learn - whether a ledger without a baseline starts one
     */
    public close(learn: boolean): TCompletedReads {
        const settled = this.raw === undefined && this.owner === this ? this.settle() : undefined;
        if (settled !== undefined) return settled;
        const raw = this.spill();
        this.raw = undefined;
        this.owner = undefined;
        return learn || this.filed !== undefined ? this.learn(raw, this.reading) : completeReads(raw);
    }
}
