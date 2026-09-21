import { TDisposer } from "../Models/Base.mjs";
import { ICarburetor } from "../Models/Store.mjs";
import { IHistoryOptions } from "../Models/Tooling.mjs";
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
    /** Starts watching a carburetor, with the current state as the first entry. */
    constructor(carburetor: ICarburetor<T>, options?: IHistoryOptions);
    /** Whether there is a past state to step back to. */
    canUndo: () => boolean;
    /** Whether an undone state is waiting to be stepped forward into. */
    canRedo: () => boolean;
    /** Steps one change back, or reports that there was nothing to step back to. */
    undo: () => boolean;
    /** Steps one undone change forward again. */
    redo: () => boolean;
    /** Forgets the recorded history, keeping the state as it is. */
    clear: () => void;
    /** Stops watching the carburetor: nothing is recorded after this. */
    disconnect: () => void;
    /** Records the state before a change, dropping the oldest entry past the limit. */
    protected record: () => void;
    /** Installs a recorded state without recording the installation itself. */
    protected apply: (state: T) => void;
}
