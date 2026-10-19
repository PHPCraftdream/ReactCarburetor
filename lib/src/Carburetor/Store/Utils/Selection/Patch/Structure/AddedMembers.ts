import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {detachOpaqueInto} from "@/Carburetor/Store/Utils/Selection/detachCore";

/** A scratch ledger that remembers every key the detach files, so the batch can be verified. */
class RecordingCopies extends WeakMap<object, unknown> {
    /** Every key filed, in order. */
    public readonly filed: object[] = [];

    /** Files one copy and remembers its key.
     *
     * @param key - the live view or raw object copied
     * @param value - its detached copy
     */
    public override set(key: object, value: unknown): this {
        this.filed.push(key);
        return super.set(key, value);
    }
}

/**
 * Detaches the members a structural patch adds, into a scratch ledger kept apart from the
 * snapshot's own until the whole batch is known to be a tree.
 *
 * A member reaching anything the previous snapshot already copied (a moved or re-added row, a
 * backlink into an existing row), or anything reached twice, refuses the batch: the full
 * reconcile owns shared topology. The owner's live-instance and array-subclass policies run as
 * in the full detach, before the ledger is touched.
 */
export class AddedMembers {
    /** Whether a member overlapped the previous snapshot or another member. */
    public refused = false;
    /** The added members' copies, apart from the snapshot's ledger. */
    private readonly copies = new RecordingCopies();
    /** Refuses the batch when the detach reaches a value twice. */
    private readonly onSharing = (): void => { this.refused = true; };

    /** Binds the snapshot's ledger and the owner's policies.
     *
     * @param ledger - the previous snapshot's raw to copy ledger
     * @param onLiveInstance - the owner's live class instance policy
     * @param onArraySubclass - the owner's array-subclass policy
     */
    constructor(
        private readonly ledger: WeakMap<object, unknown>,
        private readonly onLiveInstance: ((instance: object) => void) | undefined,
        private readonly onArraySubclass: ((instance: object) => never) | undefined
    ) {}

    /** Detaches one added member read through the live view; check `refused` afterwards.
     *
     * @param member - the member as the live view returned it
     * @returns its detached copy
     */
    public detach(member: unknown): unknown {
        if (member === null || typeof member !== 'object') return member;
        if (this.ledger.has(liveViews.readTarget(member) ?? member)) {
            this.refused = true;
            return undefined;
        }
        return detachOpaqueInto(member, this.copies, this.onLiveInstance, this.onArraySubclass, this.onSharing);
    }

    /** Files every added copy into the snapshot's ledger, unless any of them overlaps it.
     *
     * @returns whether the added members form a tree disjoint from the previous snapshot
     */
    public commit(): boolean {
        const filed = this.copies.filed;
        if (this.refused) return false;
        for (let index = 0; index < filed.length; index++) {
            if (this.ledger.has(filed[index])) return false;
        }
        for (let index = 0; index < filed.length; index++) {
            this.ledger.set(filed[index], this.copies.get(filed[index]));
        }
        return true;
    }
}
