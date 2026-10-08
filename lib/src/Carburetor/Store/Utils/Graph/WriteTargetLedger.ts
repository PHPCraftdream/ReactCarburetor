import {TPath} from '@/Carburetor/Models/Paths';

/** Reusable pending pairs; a bounded recording budget makes oversized drafts conservative. */
export class WriteTargetLedger {
    /** Whether any consumer asked for raw-target proofs; until then nothing is retained. */
    private enabled: boolean;
    /** Reusable bounded pending recordings. */
    private readonly pairs: Array<readonly [TPath, object]> = [];
    /** Whether pending recordings exceeded the budget. */
    private incomplete = false;
    /** Whether a write since the last reset was not recorded because the ledger was off. */
    private missed = false;

    /** Creates a ledger that records from the start unless a store defers it to the first consumer.
     *
     * @param enabled - record from the start (direct use); a store enables on demand
     */
    constructor(enabled = true) { this.enabled = enabled; }

    /** Starts retaining pairs for the publications that follow; a publication already part-written is incomplete. */
    public enable(): void {
        if (!this.enabled && this.missed) this.incomplete = true;
        this.enabled = true;
    }

    /** Stops retaining and releases pending pairs; a still-open publication stays incomplete if re-enabled. */
    public disable(): void {
        if (this.enabled && (this.pairs.length > 0 || this.incomplete)) this.missed = true;
        this.enabled = false;
        this.pairs.length = 0;
        this.incomplete = false;
    }

    /** Records a raw mutation without allocating a target Map or Set.
     *
     * @param path - written path
     * @param target - raw mutation target
     */
    public add(path: TPath, target: object): void {
        if (!this.enabled) { this.missed = true; return; }
        const last = this.pairs[this.pairs.length - 1];
        if (last?.[0] === path && last[1] === target) return;
        if (this.pairs.length === 4096) { this.incomplete = true; return; }
        this.pairs.push([path, target]);
    }

    /** Pending pairs, consumed synchronously before reset. */
    public get entries(): ReadonlyArray<readonly [TPath, object]> { return this.pairs; }
    /** Whether the recording budget was exhausted. */
    public get isIncomplete(): boolean { return this.incomplete; }
    /** Releases every pending target reference while retaining the buffer identity. */
    public reset(): void {
        // Assigning length is a runtime call; popping stays inline for the usual one or two pairs.
        const pairs = this.pairs;
        while (pairs.length !== 0) pairs.pop();
        this.incomplete = false;
        this.missed = false;
    }
}
