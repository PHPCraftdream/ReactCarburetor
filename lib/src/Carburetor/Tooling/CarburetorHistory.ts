import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

/**
 * Undo/redo for a carburetor, built on snapshots. Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 *
 * Cost: one deep copy of the state per change, which is the floor for snapshot-based
 * history — the previous state has to be captured while it still exists. For a large store
 * written on every keystroke that is measurable; narrow what history observes, or keep the
 * limit low.
 */
export class CarburetorHistory<T extends object> {
    protected past: T[] = [];
    protected future: T[] = [];
    protected current: T;
    protected limit: number;
    protected applying: boolean = false;
    protected dispose: TDisposer;

    /** Starts watching a carburetor, with the current state as the first entry. */
    constructor(protected carburetor: ICarburetor<T>, options: IHistoryOptions = {}) {
        this.limit = options.limit || 50;
        this.current = carburetor.snapshot();
        this.dispose = carburetor.watch(new Set([WILDCARD_PATH]), this.record);
    }

    /** Whether there is a past state to step back to. */
    public canUndo = (): boolean => {
        return this.past.length > 0;
    };

    /** Whether an undone state is waiting to be stepped forward into. */
    public canRedo = (): boolean => {
        return this.future.length > 0;
    };

    /** Steps one change back, or reports that there was nothing to step back to. */
    public undo = (): boolean => {
        const previous = this.past.pop();

        if (previous === undefined) {
            return false;
        }

        this.future.push(this.current);
        this.apply(previous);

        return true;
    };

    /** Steps one undone change forward again. */
    public redo = (): boolean => {
        const next = this.future.pop();

        if (next === undefined) {
            return false;
        }

        this.past.push(this.current);
        this.apply(next);

        return true;
    };

    /** Forgets the recorded history, keeping the state as it is. */
    public clear = (): void => {
        this.past = [];
        this.future = [];
    };

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect = (): void => {
        this.dispose();
    };

    /** Records the state before a change, dropping the oldest entry past the limit. */
    protected record = (): void => {
        if (this.applying) {
            return;
        }

        this.past.push(this.current);

        if (this.past.length > this.limit) {
            this.past.shift();
        }

        this.future = [];
        this.current = this.carburetor.snapshot();
    };

    /** Installs a recorded state without recording the installation itself. */
    protected apply = (state: T): void => {
        this.applying = true;

        try {
            // `restore` copies what it is given, so the store never aliases this entry and
            // the entry can become `current` as it is. Taking another snapshot here would
            // deep-copy the whole state a second time for nothing.
            this.carburetor.restore(state);
            this.current = state;
        } finally {
            this.applying = false;
        }
    };
}
