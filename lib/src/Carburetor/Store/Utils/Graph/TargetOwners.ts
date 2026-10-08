import {TDisposer} from '@/Carburetor/Models/Base';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {WriteTargetLedger} from './WriteTargetLedger';

/**
 * Counts the consumers that need raw-target proofs (R39-04): the first starts retention, the last
 * one's release returns the store to the state of one that never had a consumer.
 */
export class TargetOwners {
    /** Live owners. */
    private count = 0;

    /**
     * Wires the owners to one store's ledger, log and version.
     *
     * @param ledger - pending raw-target recording
     * @param log - write log retaining proofs
     * @param versionOf - the store's current version
     */
    constructor(
        private readonly ledger: WriteTargetLedger, private readonly log: WriteLog,
        private readonly versionOf: () => number
    ) {}

    /** Registers one owner.
     *
     * @returns its idempotent release
     */
    public acquire(): TDisposer {
        if (this.count++ === 0) {
            this.ledger.enable();
            this.log.track(this.versionOf());
        }
        let held = true;
        return () => {
            if (!held) return;
            held = false;
            if (--this.count === 0) {
                this.ledger.disable();
                this.log.untrack();
            }
        };
    }
}
