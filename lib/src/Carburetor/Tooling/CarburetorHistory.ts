import {TDisposer} from "../Models/Base";
import {ICarburetor} from "../Models/Store";
import {IHistoryOptions} from "../Models/Tooling";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";

/**
 * Undo/redo for a carburetor, built on snapshots. Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 */
export class CarburetorHistory<T extends {}> {
    protected past: T[] = [];
    protected future: T[] = [];
    protected current: T;
    protected limit: number;
    protected applying: boolean = false;
    protected dispose: TDisposer;

    constructor(protected carburetor: ICarburetor<T>, options: IHistoryOptions = {}) {
        this.limit = options.limit || 50;
        this.current = carburetor.snapshot();
        this.dispose = carburetor.watch(new Set([WILDCARD_PATH]), this.record);
    }

    public canUndo = (): boolean => {
        return this.past.length > 0;
    };

    public canRedo = (): boolean => {
        return this.future.length > 0;
    };

    public undo = (): boolean => {
        const previous = this.past.pop();

        if (previous === undefined) {
            return false;
        }

        this.future.push(this.current);
        this.apply(previous);

        return true;
    };

    public redo = (): boolean => {
        const next = this.future.pop();

        if (next === undefined) {
            return false;
        }

        this.past.push(this.current);
        this.apply(next);

        return true;
    };

    public clear = (): void => {
        this.past = [];
        this.future = [];
    };

    public disconnect = (): void => {
        this.dispose();
    };

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

    protected apply = (state: T): void => {
        this.applying = true;

        try {
            this.carburetor.restore(state);
            this.current = this.carburetor.snapshot();
        } finally {
            this.applying = false;
        }
    };
}
