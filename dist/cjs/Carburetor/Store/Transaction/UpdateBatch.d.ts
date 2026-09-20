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
    isActive: () => boolean;
    begin: () => void;
    end: () => void;
    add: (target: INotifiable, writes: TPathSet) => void;
    protected flush: () => void;
}
