import {TPath} from "@/Carburetor/Models/Paths";

/** How many mutation targets one publication may record before it is flagged incomplete. */
const WRITE_TARGET_BUDGET = 4096;

/**
 * The raw mutation targets one pending publication records, under a fixed within-update budget.
 *
 * A path starved of budget keeps no target and the ledger flags the publication unknown, which
 * makes the write log drop its raw proof instead of silently trusting partial targets.
 */
export class WriteTargetLedger {
    /** Recordings still allowed before the publication is flagged unknown. */
    private budget: number = WRITE_TARGET_BUDGET;
    /** The pending publication's targets, handed to the write log at emit; `reset` swaps in a
     * fresh map so a captured reference keeps its contents for the write log. */
    private map = new Map<TPath, Set<object>>();
    /** Whether targets were dropped because the budget ran out. */
    private incomplete = false;

    /** Records one mutation target under the budget; exhaustion flags the publication unknown.
     *
     * @param path - the written path.
     * @param target - the raw object the mutation landed on.
     */
    public add(path: TPath, target: object): void {
        if (this.budget === 0) {
            this.incomplete = true;
            return;
        }
        let written = this.map.get(path);
        if (written === undefined) {
            this.budget--;
            this.map.set(path, written = new Set<object>([target]));
        } else if (!written.has(target)) {
            this.budget--;
            written.add(target);
        }
    }

    /** The pending publication's target map, handed to the write log at emit. */
    public get entries(): ReadonlyMap<TPath, Set<object>> {
        return this.map;
    }

    /** Whether the pending publication dropped targets because its budget ran out. */
    public get isIncomplete(): boolean {
        return this.incomplete;
    }

    /** Closes one publication's pending target state: fresh budget, no incomplete flag. */
    public reset(): void {
        this.map = new Map<TPath, Set<object>>();
        this.incomplete = false;
        this.budget = WRITE_TARGET_BUDGET;
    }
}
