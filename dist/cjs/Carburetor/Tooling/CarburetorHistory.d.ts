import { TDisposer } from "../Models/Base.js";
import { ICarburetor } from "../Models/Store.js";
import { IHistoryOptions } from "../Models/Tooling.js";
/**
 * Undo/redo for a carburetor, built on snapshots. Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 *
 * Cost: one deep copy of the state per change, which is the floor for snapshot-based
 * history — the previous state has to be captured while it still exists. For a large store
 * written on every keystroke that is measurable; narrow what history observes, or keep the
 * limit low.
 */
export declare class CarburetorHistory<T extends object> {
    protected carburetor: ICarburetor<T>;
    protected past: T[];
    protected future: T[];
    protected current: T;
    protected limit: number;
    protected applying: boolean;
    protected dispose: TDisposer;
    constructor(carburetor: ICarburetor<T>, options?: IHistoryOptions);
    canUndo: () => boolean;
    canRedo: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
    clear: () => void;
    disconnect: () => void;
    protected record: () => void;
    protected apply: (state: T) => void;
}
