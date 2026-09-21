import { TPathSet } from "../../Models/Paths.js";
import { INotifiable } from "../../Models/Store.js";
/**
 * Collects writes while a transaction is open and delivers one notification pass per
 * carburetor when it closes. Without it a method that writes to several carburetors —
 * or a preEmit that cascades into a neighbour — produces a separate notification pass
 * for every write.
 */
export declare class UpdateBatch {
    protected depth: number;
    protected pending: Map<INotifiable, TPathSet>;
    /** Whether a transaction is open, so writes are collected rather than delivered. */
    isActive: () => boolean;
    /** Opens a transaction; nesting is counted, so only the outermost one delivers. */
    begin: () => void;
    /** Closes a transaction, delivering everything collected once the outermost one ends. */
    end: () => void;
    /** Merges writes into what a carburetor will be notified about. */
    add: (target: INotifiable, writes: TPathSet) => void;
    /** Delivers one notification pass per carburetor, draining what the passes add. */
    protected flush: () => void;
}
