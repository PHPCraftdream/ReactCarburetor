import {Carburetor, CarburetorHistory, ICarburetor, TDisposer} from "@/Carburetor";
import {IUndoData} from "./Models";

/**
 * Undo/redo over another store, with `canUndo`/`canRedo` as state a component can read.
 * CarburetorHistory keeps the snapshots; this store only publishes what the buttons need.
 */
export class UndoCarburetor<T extends object> extends Carburetor<IUndoData> {
    /** The snapshots of the watched store. */
    protected history: CarburetorHistory<T>;

    /** Stops listening to the watched store. */
    protected stopWatching: TDisposer;

    /**
     * Starts recording the given store, with its current state as the baseline.
     *
     * @param source - the store undo and redo apply to
     */
    constructor(source: ICarburetor<T>) {
        super({canUndo: false, canRedo: false});

        this.history = new CarburetorHistory<T>(source, {limit: 50});

        // Needs "every write" — subscribe with no `reads` says that directly, the same choice
        // CarburetorHistory itself makes for the same reason.
        const subscriptionId = source.subscribe(this.refresh);

        this.stopWatching = () => source.unsubscribe(subscriptionId);
    }

    /** Steps the watched store one change back. */
    public undo = (): void => {
        this.history.undo();
    };

    /** Steps one undone change forward again. */
    public redo = (): void => {
        this.history.redo();
    };

    /** Forgets the history, e.g. once a fresh list arrived from the server. */
    public reset = (): void => {
        this.history.clear();
        this.refresh();
    };

    /** Stops recording and listening. */
    public disconnect = (): void => {
        this.history.disconnect();
        this.stopWatching();
    };

    /**
     * Copies the history's flags into state. It runs from inside the watched store's
     * notification, where publishing another store at once is unsafe, so it publishes on the
     * next microtask with emitSoon().
     */
    protected refresh = (): void => {
        const canUndo = this.history.canUndo();
        const canRedo = this.history.canRedo();

        if (this.data.canUndo === canUndo && this.data.canRedo === canRedo) {
            return;
        }

        this.draft.canUndo = canUndo;
        this.draft.canRedo = canRedo;
        this.emitSoon();
    };
}
