// The alias answer per opaque value is cached until the root's alias generation changes.
/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from "@/Carburetor";

interface IRow {
    n: number;
}

class Payload {
    public constructor(public readonly items: IRow[]) {}
}

interface IState {
    row: IRow;
    other: IRow;
    model: Payload;
    map: Map<string, IRow>;
    set: Set<unknown>;
}

class AliasCacheStore extends Carburetor<IState> {
    public put(n: number): void {
        this.update(draft => { draft.row.n = n; });
    }

    public putOther(n: number): void {
        this.update(draft => { draft.other.n = n; });
    }

    public replaceRow(row: IRow): void {
        this.update(draft => { draft.row = row; });
    }

    public putMapMember(key: string, row: IRow): void {
        this.update(draft => { draft.map.set(key, row); });
    }
}

const ROWS = 64;
const makeStore = (): {store: AliasCacheStore; rows: IRow[]} => {
    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    const store = new AliasCacheStore({
        row: rows[0], other: {n: -1}, model: new Payload(rows),
        map: new Map([['row', rows[0]]]), set: new Set(),
    });
    return {store, rows};
};

/** Counts Reflect.ownKeys calls on the given objects while the body runs. */
const withOwnKeyVisits = async (
    objects: object[], run: () => Promise<void> | void
): Promise<number> => {
    const original = Reflect.ownKeys;
    let visits = 0;
    Reflect.ownKeys = function (target: object): PropertyKey[] {
        if (objects.includes(target)) visits++;
        return original(target);
    };
    try {
        await run();
    } finally {
        Reflect.ownKeys = original;
    }
    return visits;
};

describe('native alias read cache', () => {
    test('a second read of the same opaque value walks no graph', async () => {
        const {store} = makeStore();
        const model = store.getData().model;
        const read = (): void => {
            void store.read(() => undefined).model;
        };
        read();
        const secondReadVisits = await withOwnKeyVisits([model], () => { read(); });
        expect(secondReadVisits).toBe(0);
    });

    test('a facade set and a plain topology write each force exactly one re-walk', async () => {
        const {store} = makeStore();
        const model = store.getData().model;
        const read = (): void => {
            const view = store.read(() => undefined);
            void view.model;
            view.map.get('row');
        };
        read();

        const facadeVisits = await withOwnKeyVisits([model], () => {
            store.putMapMember('row', {n: 100});
            read();
        });
        expect(facadeVisits).toBe(1);

        const topologyVisits = await withOwnKeyVisits([model], () => {
            store.replaceRow({n: 200});
            read();
        });
        expect(topologyVisits).toBe(1);
    });

    test('a cached alias still subscribes the reader to its plain path', () => {
        const {store, rows} = makeStore();
        const read = (): Set<string> => {
            const paths = new Set<string>();
            const view = store.read(path => paths.add(path));
            void view.model;
            view.map.get('row');
            return paths;
        };
        expect(read().has('row')).toBe(true);
        const cached = read();
        expect(cached.has('row')).toBe(true);

        let renders = 0;
        store.subscribe(() => { renders++; }, {reads: cached});
        store.putOther(7);
        expect(renders).toBe(0);
        store.put(3);
        expect(renders).toBe(1);
        expect(rows[0].n).toBe(3);
    });
});
