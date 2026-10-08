// Scalar writes rebuild nothing; uniquely owned topology is repaired locally. Opaque
// facade mutations still discard the index and rebuild on the next native read.
/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from "@/Carburetor";

interface IState {
    rows: {n: number}[];
    map: Map<number, {n: number}>;
}

class AliasIndexStore extends Carburetor<IState> {
    public writeScalar(): void {
        this.update(draft => { draft.rows[0].n += 1; });
    }

    public replaceRow(index: number, row: {n: number}): void {
        this.update(draft => { draft.rows[index] = row; });
    }

    public deleteRow(index: number): void {
        this.update(draft => { delete draft.rows[index]; });
    }

    public writeMapMember(index: number, row: {n: number}): void {
        this.update(draft => { draft.map.set(index, row); });
    }

    public readNative(): IState['map'] {
        return this.read(() => undefined).map;
    }
}

const ROWS = 32;
const makeStore = (): {store: AliasIndexStore; root: IState} => {
    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    const root: IState = {rows, map: new Map(rows.map((row, index) => [index, row]))};
    return {store: new AliasIndexStore(root), root};
};

/** Counts indexRoot walks: ownership rebuilds reflect on every own key of the root. */
const withRootVisits = async (root: IState, run: () => Promise<void> | void): Promise<number> => {
    const original = Reflect.getOwnPropertyDescriptor;
    let visits = 0;
    Reflect.getOwnPropertyDescriptor = function (object: object, key: PropertyKey) {
        if (object === root) visits++;
        return original(object, key);
    };
    try {
        await run();
    } finally {
        Reflect.getOwnPropertyDescriptor = original;
    }
    return visits;
};

describe('native alias index freshness', () => {
    test('scalar reads and uniquely owned topology avoid rebuilds; opaque facade writes rebuild', async () => {
        const {store, root} = makeStore();
        expect(store.readNative().get(0)).toBeDefined();

        const scalarVisits = await withRootVisits(root, () => {
            for (let cycle = 0; cycle < 4; cycle++) {
                store.writeScalar();
                if (store.readNative().get(1) === undefined) throw new Error('Map member lost');
            }
        });
        expect(scalarVisits).toBe(0);

        const topologyVisits = await withRootVisits(root, () => {
            store.replaceRow(2, {n: -2});
            expect(store.readNative().get(2)).toBeDefined();
        });
        // Replacement and deletion touch only the changed row, never the root.
        expect(topologyVisits).toBe(0);

        const deleteVisits = await withRootVisits(root, () => {
            store.deleteRow(3);
            expect(store.readNative().get(3)).toBeDefined();
        });
        expect(deleteVisits).toBe(0);

        const facadeVisits = await withRootVisits(root, () => {
            store.writeMapMember(4, {n: -4});
            expect(store.readNative().get(4)).toBeDefined();
        });
        expect(facadeVisits).toBeGreaterThan(0);
    });

    test('aliases recorded after scalar writes still wake a subscribed selection', () => {
        const {store} = makeStore();
        const changes: number[] = [];
        const stop = store.watch(
            data => (data.map.get(0) as {n: number}).n,
            next => { changes.push(next); }
        );
        try {
            store.writeScalar();
            expect(changes).toEqual([1]);
            store.replaceRow(0, {n: 40});
            expect((store.readNative().get(0) as {n: number}).n).toBe(1);
            store.writeMapMember(0, {n: 41});
            expect(changes).toEqual([1, 41]);
        } finally {
            stop();
        }
    });
});
