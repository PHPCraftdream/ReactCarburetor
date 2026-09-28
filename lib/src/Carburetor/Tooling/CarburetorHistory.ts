import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";

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
    /** States to step back to; the oldest is dropped once `limit` is exceeded. */
    protected past: T[] = [];
    /** Undone states waiting for redo; any fresh write empties it. */
    protected future: T[] = [];
    /** The state as of the last recorded change, awaiting promotion into `past`. */
    protected current: T;
    /** The most states `past` may hold; set from options at construction. */
    protected limit: number;
    /** Set inside apply() so the watcher ignores changes history installs itself. */
    protected applying: boolean = false;
    /** The watch installed at construction; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;

    /** Bound once for `subscribe`, called detached from `this`; forwards to the overridable `record`. */
    private readonly recordBound = (): void => this.record();

    /**
     * Starts watching a carburetor, with the current state as the first entry.
     *
     * History needs "every write", which `watch(select, onChange)` cannot express cheaply (its
     * selector would have to read the whole tree, then diff it, on every change) — `subscribe`
     * with no `reads` is the engine's own way to say that, so history uses it directly instead
     * of reconstructing the same thing through `watch`.
     *
     * @param carburetor - the store being tracked: snapshots become the entries, restore() applies undo and redo to it
     * @param options - `limit` caps how far back undo reaches; defaults to 50 entries when omitted
     */
    constructor(protected carburetor: ICarburetor<T>, options: IHistoryOptions = {}) {
        this.limit = options.limit || 50;
        this.current = carburetor.snapshot();

        const subscriptionId = carburetor.subscribe(this.recordBound);

        this.dispose = () => carburetor.unsubscribe(subscriptionId);
    }

    /**
     * Whether there is a past state to step back to.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it. `undo`/`redo` are a
     * breaking change from the earlier arrow fields — detaching them (for example
     * `onClick={history.undo}`) now needs an explicit bind at the call site.
     */
    public canUndo(): boolean {
        return this.past.length > 0;
    }

    /** Whether an undone state is waiting to be stepped forward into. */
    public canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Steps one change back, or reports that there was nothing to step back to. */
    public undo(): boolean {
        const previous = this.past.pop();

        if (previous === undefined) {
            return false;
        }

        this.future.push(this.current);
        this.apply(previous);

        return true;
    }

    /** Steps one undone change forward again. */
    public redo(): boolean {
        const next = this.future.pop();

        if (next === undefined) {
            return false;
        }

        this.past.push(this.current);
        this.apply(next);

        return true;
    }

    /** Forgets the recorded history, keeping the state as it is. */
    public clear(): void {
        this.past = [];
        this.future = [];
    }

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect(): void {
        this.dispose();
    }

    /** Records the state before a change, dropping the oldest entry past the limit. */
    protected record(): void {
        if (this.applying) {
            return;
        }

        this.past.push(this.current);

        if (this.past.length > this.limit) {
            this.past.shift();
        }

        this.future = [];
        this.current = this.carburetor.snapshot();
    }

    /** Installs a recorded state without recording the installation itself. */
    protected apply(state: T): void {
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
    }
}
