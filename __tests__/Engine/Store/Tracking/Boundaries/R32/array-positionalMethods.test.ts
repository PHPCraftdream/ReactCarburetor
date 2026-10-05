import {Carburetor, CarburetorHistory} from "@/Carburetor";
import {CARBURETOR_NOTIFY_WRITES} from "@/Carburetor/Store/Utils/Models";
import {WriteLog} from "@/Carburetor/Store/Paths/WriteLog";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {types} from "node:util";

interface IRow {
    id: number;
    title: string;
    done: boolean;
    a: number;
    b: number;
    c: number;
}

interface IBoard {
    rows: IRow[];
    boardTags: string[];
}

const makeRow = (n: number): IRow =>
    ({id: n, title: 't' + n, done: n % 2 === 0, a: n * 3, b: n % 5, c: 10 - n});

const makeBoard = (count: number): IBoard => ({
    rows: Array.from({length: count}, (_, n) => makeRow(n)),
    boardTags: ['x', 'y'],
});

class BoardCarburetor extends Carburetor<IBoard> {
    public lastWrites: TPath[] | undefined = undefined;

    /** Captures the exact path set of the last emit. */
    public [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void {
        this.lastWrites = [...writes];
        super[CARBURETOR_NOTIFY_WRITES](writes);
    }
}

const run = (
    make: () => BoardCarburetor, op: (draft: IBoard) => unknown
): {store: BoardCarburetor; result: unknown} => {
    const store = make();
    const result: unknown = store.update((draft: IBoard) => op(draft));

    return {store, result};
};

/** Same operation on a detached plain copy; returns the mutated rows, for spec parity. */
const reference = (rows: IRow[], op: (draft: IBoard) => unknown): unknown => {
    const board: IBoard = {rows: rows.map(row => ({...row})), boardTags: ['x', 'y']};

    op(board);

    return board.rows;
};

describe('positional array methods through draft (R32-03)', () => {
    const positionalOps: [string, (draft: IBoard) => unknown][] = [
        ['splice(0,1)', draft => draft.rows.splice(0, 1)],
        ['splice(5000-style mid,1)', draft => draft.rows.splice(20, 1)],
        ['shift()', draft => draft.rows.shift()],
        ['unshift(row)', draft => draft.rows.unshift(makeRow(999))],
        ['reverse()', draft => draft.rows.reverse()],
        ['sort(byId)', draft => draft.rows.sort((a, b) => b.id - a.id)],
        ['copyWithin', draft => draft.rows.copyWithin(2, 0, 2)],
        ['fill', draft => draft.rows.fill(makeRow(7), 1, 3)],
    ];

    test.each(positionalOps)('%p: result matches the native algorithm, no field-diff paths', (_name, op) => {
        const initial = makeBoard(40);
        const rowsBefore = initial.rows.slice();
        const {store} = run(() => new BoardCarburetor(initial), op);
        const writes = store.lastWrites ?? [];
        const fieldDiffs = writes.filter(path => path.split('.').length > 2);

        expect(fieldDiffs).toEqual([]);
        expect(store.getData().rows).toEqual(reference(rowsBefore, op));
        expect(writes.length).toBeLessThanOrEqual(initial.rows.length + 3);
    });

    test('splice(0,1) records exactly the shifted indices, length and keys marker', () => {
        const {store} = run(() => new BoardCarburetor(makeBoard(4)), draft => {
            draft.rows.splice(0, 1);
        });

        const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

        expect([...store.lastWrites ?? []].sort(compare)).toEqual([
            'rows.0', 'rows.1', 'rows.2', 'rows.3', 'rows.~k', 'rows.length',
        ].sort(compare));
    });

    test('splice(mid,1) records N/2+2 paths, not a field per shifted row', () => {
        const {store} = run(() => new BoardCarburetor(makeBoard(40)), draft => {
            draft.rows.splice(20, 1);
        });

        expect(store.lastWrites?.length).toEqual(22);
    });

    test('return values follow the spec: mutators return the draft, extractors the removed', () => {
        const board = new BoardCarburetor(makeBoard(4));
        board.update((draft: IBoard) => {
            const sorted = draft.rows.sort((a, b) => a.id - b.id);

            expect(sorted).toBe(draft.rows);
            expect(types.isProxy(sorted)).toBe(true);

            const reversed = draft.rows.reverse();

            expect(reversed).toBe(draft.rows);

            const filled = draft.rows.fill(makeRow(0), 0, 1);

            expect(filled).toBe(draft.rows);

            const removed = draft.rows.splice(1, 1);

            expect(removed).toEqual([{...makeRow(2)}]);

            const shifted = draft.rows.shift();

            expect(shifted).toEqual(makeRow(0) as unknown);

            const length = draft.rows.unshift(makeRow(50));

            expect(length).toEqual(3);
        });
    });

    test('engine views passed as arguments are unwrapped, never stored as state', () => {
        const board = new BoardCarburetor(makeBoard(3));
        board.update((draft: IBoard) => {
            const view = draft.rows[0];

            draft.rows.splice(1, 0, view);
        });

        const rows = board.getData().rows;

        expect(types.isProxy(rows[1])).toBe(false);
        expect(rows[1]).toBe(rows[0]);
    });

    test('empty operations publish nothing and bump no version', () => {
        const ordered = new BoardCarburetor(makeBoard(4));
        const before = ordered.getVersion();
        let wakes = 0;

        ordered.subscribe(() => wakes++, {id: 'any'});

        ordered.update((draft: IBoard) => {
            draft.rows.sort((a, b) => a.id - b.id);
        });
        ordered.update((draft: IBoard) => {
            draft.rows.splice(0, 0);
        });
        ordered.update((draft: IBoard) => {
            draft.rows.copyWithin(0, 0);
        });

        expect(ordered.getVersion()).toEqual(before);
        expect(wakes).toEqual(0);
        expect(ordered.lastWrites).toBeUndefined();
    });

    test('scalar arrays re-index precisely and wake only moved indices', () => {
        const tags = new BoardCarburetor({rows: [], boardTags: ['a', 'b', 'c', 'd']});
        let firstWakes = 0;
        let lastWakes = 0;

        tags.subscribe(() => firstWakes++, {id: 't0', reads: new Set<TPath>(['boardTags.0'])});
        tags.subscribe(() => lastWakes++, {id: 't3', reads: new Set<TPath>(['boardTags.3'])});

        tags.update((draft: IBoard) => {
            draft.boardTags.reverse();
        });

        expect(firstWakes).toEqual(1);
        expect(lastWakes).toEqual(1);
    });
});

describe('positional methods: history undo/redo', () => {
    const historyCases: [string, (draft: IBoard) => void][] = [
        ['splice', draft => {
            draft.rows.splice(1, 1);
        }],
        ['sort', draft => {
            draft.rows.sort((a, b) => b.id - a.id);
        }],
        ['reverse', draft => {
            draft.rows.reverse();
        }],
        ['shift', draft => {
            draft.rows.shift();
        }],
        ['unshift', draft => {
            draft.rows.unshift(makeRow(31));
        }],
        ['scalar splice', draft => {
            draft.boardTags.splice(1, 1);
        }],
    ];

    test.each(historyCases)('%p restores the exact state on undo and re-applies on redo', (_name, op) => {
        const initial = makeBoard(5);
        const initialJson = JSON.stringify(initial);
        const store = new BoardCarburetor(initial);
        const history = new CarburetorHistory<IBoard>(store);

        store.update(op);
        const after = JSON.stringify(store.getData());

        expect(after).not.toEqual(initialJson);

        history.undo();
        expect(JSON.stringify(store.getData())).toEqual(initialJson);

        history.redo();
        expect(JSON.stringify(store.getData())).toEqual(after);
    });

    test('a nested root array round-trips through undo/redo', () => {
        class Tags extends Carburetor<string[]> {
            public spliceOut(): void {
                this.update((draft: string[]) => {
                    draft.splice(0, 1);
                });
            }

            public reorder(): void {
                this.update((draft: string[]) => {
                    draft.sort((a, b) => a < b ? -1 : a > b ? 1 : 0).reverse();
                });
            }
        }

        const initial = ['a', 'b', 'c'];
        const store = new Tags([...initial]);
        const history = new CarburetorHistory<string[]>(store);

        store.spliceOut();
        store.reorder();
        const after = JSON.stringify(store.getData());

        history.undo();
        history.undo();
        expect(JSON.stringify(store.getData())).toEqual(JSON.stringify(initial));

        history.redo();
        history.redo();
        expect(JSON.stringify(store.getData())).toEqual(after);
    });
});

/**
 * The pre-R32-03 reference: index every path, then forget everything on overflow.
 *
 * @param capacity - the log's entry bound.
 */
class ReferenceLog {
    private readonly capacity: number;
    private readonly last: Map<TPath, number> = new Map<TPath, number>();
    private readonly under: Map<TPath, number> = new Map<TPath, number>();
    private wildcardVersion = 0;
    private watermark = 0;

    /** @param capacity - the reference's own entry bound, mirroring the real log's. */
    constructor(capacity: number) {
        this.capacity = capacity;
    }

    /** @param version - emit version. @param writes - emitted paths. */
    public record(version: number, writes: TPathSet): void {
        for (const path of writes) {
            if (path === WILDCARD_PATH) {
                this.wildcardVersion = version;
                continue;
            }
            this.last.set(path, version);
            let cut = path.lastIndexOf('.');
            while (cut > 0) {
                this.under.set(path.slice(0, cut), version);
                cut = path.lastIndexOf('.', cut - 1);
            }
        }
        if (this.last.size + this.under.size > this.capacity) {
            this.last.clear();
            this.under.clear();
            this.watermark = version;
        }
    }

    /** @param baseline - read version. @param reads - read paths. */
    public matches(baseline: number, reads: ReadonlySet<TPath>): boolean {
        if (baseline < this.watermark || this.wildcardVersion > baseline) return true;
        if (reads.has(WILDCARD_PATH)) return true;
        for (const path of reads) {
            if ((this.last.get(path) ?? 0) > baseline || (this.under.get(path) ?? 0) > baseline) {
                return true;
            }
            let cut = path.lastIndexOf('.');
            while (cut > 0) {
                if ((this.last.get(path.slice(0, cut)) ?? 0) > baseline) return true;
                cut = path.lastIndexOf('.', cut - 1);
            }
        }
        return false;
    }
}

describe('WriteLog early exit on overflow (R32-03)', () => {
    const emit = (paths: string[]): TPathSet => new Set<TPath>(paths);
    const readSets: TPathSet[] = [
        new Set<TPath>(['row.5']),
        new Set<TPath>(['row.5.leaf']),
        new Set<TPath>(['row']),
        new Set<TPath>([WILDCARD_PATH]),
        new Set<TPath>(['unrelated', 'row.299.n']),
    ];

    test.each([100, 8192])('answers match the reference on overflow, capacity %p', capacity => {
        const log = new WriteLog(capacity);
        const referenceLog = new ReferenceLog(capacity);
        let version = 0;

        const step = (writes: TPathSet): void => {
            version++;
            log.record(version, writes);
            referenceLog.record(version, writes);
        };

        step(emit(Array.from({length: 30}, (_, n) => 'warm.' + n)));

        for (let round = 0; round < 4; round++) {
            const paths = Array.from({length: 60}, (_, n) => 'row.' + (round * 60 + n) + '.n');

            step(emit(paths));

            if (round === 2) {
                step(emit([WILDCARD_PATH, 'extra.1', 'extra.2']));
            }
            if (round === 3) {
                step(emit(['late.1', WILDCARD_PATH, 'late.2', 'late.3']));
            }

            for (const reads of readSets) {
                for (const baseline of [version - 1, version, version + 1]) {
                    expect(log.matches(baseline, reads))
                        .toEqual(referenceLog.matches(baseline, reads));
                }
            }
        }
    });

    test('an oversized emit stops indexing instead of building every entry', () => {
        const log = new WriteLog(1024);

        log.record(1, emit(Array.from({length: 50_000}, (_, n) => 'row.' + n)));

        expect(log.matches(0, new Set<TPath>(['row.49999']))).toBe(true);
        expect(log.matches(1, new Set<TPath>(['row.49999']))).toBe(false);
    });
});
