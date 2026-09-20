import { TDisposer } from "../Models/Base.js";
import { ICarburetor } from "../Models/Store.js";
import { IHistoryOptions } from "../Models/Tooling.js";
/**
 * Undo/redo for a carburetor, built on snapshots. Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 */
export declare class CarburetorHistory<T extends {}> {
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
