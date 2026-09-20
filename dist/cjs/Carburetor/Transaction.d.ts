import { TPathSet } from "./Models.js";
/** A carburetor as seen by the batch coordinator. */
export interface INotifiable {
    notifyWrites: (writes: TPathSet) => void;
}
/**
 * Collects writes while a transaction is open and delivers one notification pass per
 * carburetor when it closes. Without it a method that writes to several carburetors —
 * or a preEmit that cascades into a neighbour — produces a separate notification pass
 * for every write.
 */
export declare class UpdateBatch {
    protected depth: number;
    protected pending: Map<INotifiable, TPathSet>;
    isActive: () => boolean;
    begin: () => void;
    end: () => void;
    add: (target: INotifiable, writes: TPathSet) => void;
    protected flush: () => void;
}
export declare const updateBatch: UpdateBatch;
/**
 * Runs `body` as one update: every write inside it is delivered to subscribers once,
 * after the body returns.
 */
export declare const transaction: <R>(body: () => R) => R;
