import {Carburetor} from "@/Carburetor";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";
import {IProxyCache, PROXY_CACHE} from "@/Carburetor/Store/Tracking/Models";
import {ConnectionFacadeHandler} from "@/Carburetor/Component/Connection/ConnectionFacadeHandler";
import {IConnectionSource} from "@/Carburetor/Component/Models/Connection";
import {TPath} from "@/Carburetor/Models/Paths";
import {TReadonly} from "@/Carburetor/Models/Base";

interface IRow {
    v: {n: number};
}

interface IStoreData {
    rows: Record<string, IRow>;
}

const makeStore = (rows: Record<string, IRow>): Carburetor<IStoreData> => new Carburetor<IStoreData>({rows});

/** A plain detached snapshot shorter than the store's rows: the compare exits on the key count. */
const shortSnapshot = (): Record<string, unknown> => ({a: {v: {n: 1}}, b: {v: {n: 2}}});

describe('the internal keys hatch (R33-04)', () => {
    test('sameSelection on a live view enumerates keys through the hatch: no branch is wrapped', () => {
        const rawRows = {a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}};
        const carburetor = makeStore(rawRows);
        const view = carburetor.read(() => undefined);

        expect(sameSelection(shortSnapshot(), view.rows as unknown as Record<string, unknown>)).toBe(false);

        // `Object.keys` through the view is the descriptor trap per key, and the descriptor trap
        // files a wrapped branch per key even though the key-count mismatch reads no value. The
        // hatch records the key-set marker and stops: the compare owns no wrappers at all.
        const cache = (view.rows as unknown as {[PROXY_CACHE]: IProxyCache})[PROXY_CACHE];

        expect(cache.owns('rows.a', rawRows.a)).toBe(false);
        expect(cache.owns('rows.b', rawRows.b)).toBe(false);
        expect(cache.owns('rows.c', rawRows.c)).toBe(false);
    });

    test('sameSelection through the hatch reads exactly the key-set marker and no leaf', () => {
        const carburetor = makeStore({a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}});
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));

        expect(sameSelection(shortSnapshot(), view.rows as unknown as Record<string, unknown>)).toBe(false);
        expect(new Set(reads)).toEqual(new Set<TPath>(['rows.~p', 'rows.~k']));
    });

    test('an equal compare through the hatch records the same marker and leaf set as a value read', () => {
        const carburetor = makeStore({a: {v: {n: 1}}, b: {v: {n: 2}}});
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));
        const snapshot: Record<string, unknown> = {a: {v: {n: 1}}, b: {v: {n: 2}}};

        expect(sameSelection(snapshot, view.rows as unknown as Record<string, unknown>)).toBe(true);
        expect(new Set(reads)).toEqual(new Set<TPath>([
            'rows.~p', 'rows.~k',
            'rows.a.~p', 'rows.a.~k', 'rows.a.v.~p', 'rows.a.v.~k', 'rows.a.v.n',
            'rows.b.~p', 'rows.b.~k', 'rows.b.v.~p', 'rows.b.v.~k', 'rows.b.v.n',
        ]));
    });

    test('detachOpaque through the hatch records the same read set the enumeration protocol did', () => {
        const carburetor = makeStore({a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}});
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));

        const copy = detachOpaque(view.rows) as unknown as Record<string, Record<string, number>>;
        const readSet = new Set(reads);

        expect(copy).toEqual({a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}});
        expect(copy.a).not.toBe(view.rows.a);
        expect(readSet).toEqual(new Set<TPath>([
            'rows.~p', 'rows.~k',
            'rows.a.~p', 'rows.a.~k', 'rows.a.v.~p', 'rows.a.v.~k', 'rows.a.v.n',
            'rows.b.~p', 'rows.b.~k', 'rows.b.v.~p', 'rows.b.v.~k', 'rows.b.v.n',
            'rows.c.~p', 'rows.c.~k', 'rows.c.v.~p', 'rows.c.v.~k', 'rows.c.v.n',
        ]));
    });

    test('sameSelection through a facade branch enumerates via the hatch: no branch is wrapped', () => {
        const rawRows = {a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}};
        const carburetor = makeStore(rawRows);
        const source: IConnectionSource<IStoreData> = {
            connection: {uid: 'stub', getCarburetor: () => carburetor, committed: undefined, installed: undefined},
            getCarburetor: () => carburetor,
            resolveAttemptSource: () => carburetor,
            recorder: () => undefined,
            arrayFacade: false,
            probeError: undefined,
            cachedTarget: undefined,
            cachedView: undefined,
        };
        const facade = new Proxy({} as TReadonly<IStoreData>, new ConnectionFacadeHandler(source)) as unknown as
            Record<string, unknown>;

        expect(sameSelection(shortSnapshot(), facade['rows'] as unknown as Record<string, unknown>)).toBe(false);

        const cache = facade[PROXY_CACHE] as unknown as IProxyCache;

        expect(cache.owns('rows.a', rawRows.a)).toBe(false);
        expect(cache.owns('rows.c', rawRows.c)).toBe(false);
    });

    test('the hatch records into the connection recorder through a connect facade, wrapping nothing', () => {
        const rawRows = {a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}};
        const carburetor = makeStore(rawRows);
        const reads: TPath[] = [];
        const source: IConnectionSource<IStoreData> = {
            connection: {uid: 'stub', getCarburetor: () => carburetor, committed: undefined, installed: undefined},
            getCarburetor: () => carburetor,
            resolveAttemptSource: () => carburetor,
            recorder: (path: TPath) => {
                reads.push(path);
            },
            arrayFacade: false,
            probeError: undefined,
            cachedTarget: undefined,
            cachedView: undefined,
        };
        const facade = new Proxy({} as TReadonly<IStoreData>, new ConnectionFacadeHandler(source)) as unknown as
            Record<string, unknown>;

        // The facade forwards the hatch read to the resolved view, whose get trap records the
        // root key-set marker into this connection's recorder.
        expect(sameSelection(shortSnapshot(), facade)).toBe(false);
        expect(reads).toEqual(['~k']);

        const cache = (facade[PROXY_CACHE] as unknown as IProxyCache);

        expect(cache.owns('rows.a', rawRows.a)).toBe(false);
    });

    test('raw objects and foreign proxies without the hatch keep the plain Object.keys behavior', () => {
        const raw = {a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}};
        const foreign = new Proxy(raw, {});

        expect(sameSelection(shortSnapshot(), foreign as unknown as Record<string, unknown>)).toBe(false);
        expect(sameSelection(
            {a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}},
            foreign as unknown as Record<string, unknown>
        )).toBe(true);
        expect(detachOpaque(foreign)).toEqual({a: {v: {n: 1}}, b: {v: {n: 2}}, c: {v: {n: 3}}});
    });
});
