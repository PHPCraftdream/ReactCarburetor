import {TPath, TPathSet} from "../../Models/Paths";
import {ICarburetorSubscription} from "../../Models/Store";
import {completeReads} from "../../Store/Tracking/Observation/completeReads";
import {TCompletedReads} from "../../Store/Tracking/Observation/Models";
import {IAttemptEntry, IDependencySlot} from "./Connection";
import {ReadLedger} from "../../Store/Paths/Markers/ReadLedger";

/**
 * One source's read record inside one render attempt, recorded copy-on-divergence.
 *
 * While the slot's ledger holds the committed raw recording, each path is matched against it and
 * no set exists; the first unknown path, or any direct use of `reads`, copies the matched paths
 * out. A commit of a recording identical to the learned one adopts the learned closed set as is.
 */
export class AttemptEntry implements IAttemptEntry {
    /** `reads` is a filed set adopted by identity; it is copied before it gains a path. */
    public sharedReads?: boolean;
    /** Tentative proof ownership, published only when this attempt commits. */
    public targetsWanted?: boolean;
    /** Canonical resource entries read by this attempt. */
    public resourcePaths?: Set<TPath>;
    /** Paths recorded since the copy, or an adopted set; undefined while the ledger counts. */
    private own: TPathSet | undefined = undefined;
    /** The slot ledger this recording still matches path by path. */
    private ledger: ReadLedger | undefined = undefined;

    /**
     * Opens the record, counting against the slot's ledger when it describes the registered set.
     *
     * @param source - the carburetor the read resolved to
     * @param baselineVersion - the store version at the first touch
     * @param slot - the dependency slot this record will commit into, when it already exists
     */
    constructor(
        public source: ICarburetorSubscription,
        public baselineVersion: number,
        slot?: IDependencySlot
    ) {
        const ledger = slot?.ledger;
        if (ledger !== undefined && ledger.claim(this, source, slot!.installed?.reads)) this.ledger = ledger;
        else this.own = new Set<TPath>();
    }

    /** The paths read so far; copies them out of the ledger first. */
    public get reads(): TPathSet {
        return this.own ?? this.spill();
    }

    /** Replaces the paths with an adopted set; the ledger count ends first. */
    public set reads(reads: TPathSet) {
        if (this.ledger !== undefined) this.spill();
        this.own = reads;
    }

    /**
     * Records one read path; an adopted set is copied before it gains a path it lacks.
     *
     * @param path - the path a read touched
     */
    public record(path: TPath): void {
        if (this.ledger !== undefined && this.ledger.hit(path)) return;
        let reads = this.reads;
        if (this.sharedReads === true) {
            if (reads.has(path)) return;
            reads = this.own = new Set<TPath>(reads);
            this.sharedReads = false;
        }
        reads.add(path);
    }

    /** Copies the counted paths out of the ledger and stops counting. */
    public spill(): TPathSet {
        const ledger = this.ledger;
        if (ledger !== undefined) {
            this.ledger = undefined;
            this.own = ledger.release();
        }
        return this.own!;
    }

    /**
     * Closes the record for a commit: the learned set for an identical recording, otherwise the
     * completed own set, learned by the slot's ledger when the slot commits again.
     *
     * @param slot - the slot being committed, absent for a slot created by this commit
     * @param learn - whether to start a ledger for a slot that has none
     */
    public complete(slot: IDependencySlot | undefined, learn: boolean): TCompletedReads {
        const settled = this.ledger?.settle();
        if (settled !== undefined) {
            // Later reads must not reach the registered set.
            this.ledger = undefined;
            this.own = settled as unknown as TPathSet;
            this.sharedReads = true;
            return settled;
        }
        const reads = this.reads;
        if (this.sharedReads === true) return reads as unknown as TCompletedReads;
        if (slot === undefined || (slot.ledger === undefined && !learn)) return completeReads(reads);
        return (slot.ledger ??= new ReadLedger()).learn(reads, this.source);
    }
}
