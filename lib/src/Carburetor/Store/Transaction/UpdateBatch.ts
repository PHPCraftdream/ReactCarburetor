import {TPath, TPathSet} from "../../Models/Paths";
import {INotifiable} from "../../Models/Store";

/**
 * Collects writes while a transaction is open and delivers one notification pass per
 * carburetor when it closes. Without it a method that writes to several carburetors —
 * or a preEmit that cascades into a neighbour — produces a separate notification pass
 * for every write.
 */
export class UpdateBatch {
    protected depth: number = 0;
    protected pending: Map<INotifiable, TPathSet> = new Map<INotifiable, TPathSet>();

    public isActive = (): boolean => {
        return this.depth > 0;
    };

    public begin = (): void => {
        this.depth++;
    };

    public end = (): void => {
        this.depth--;

        if (this.depth > 0) {
            return;
        }

        this.depth = 0;
        this.flush();
    };

    public add = (target: INotifiable, writes: TPathSet): void => {
        const merged = this.pending.get(target);

        if (!merged) {
            this.pending.set(target, new Set<TPath>(writes));

            return;
        }

        writes.forEach((path: TPath) => merged.add(path));
    };

    protected flush = (): void => {
        // A notification may open a new transaction, so drain until nothing is left.
        while (this.pending.size > 0) {
            const batch = Array.from(this.pending.entries());
            this.pending.clear();

            batch.forEach(([target, writes]: [INotifiable, TPathSet]) => {
                target.notifyWrites(writes);
            });
        }
    };
}
