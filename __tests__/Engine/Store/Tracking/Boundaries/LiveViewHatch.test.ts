import {Carburetor} from '@/Carburetor';
import {TPath} from '@/Carburetor/Models/Paths';
import {IProxyCache, PROXY_CACHE, RAW_TARGET} from '@/Carburetor/Store/Tracking/Models';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';

interface IRow {
    n: number;
}

interface ITree {
    rows: IRow[];
}

const getTree = (count: number): ITree => ({
    rows: Array.from({length: count}, (_, n) => ({n})),
});

/** Captures every WeakMap.set performed while `run` executes, by (map, key) pairs. */
const captureWeakMapSets = (run: () => void): Array<[WeakMap<object, unknown>, object]> => {
    const original = WeakMap.prototype.set;
    const captured: Array<[WeakMap<object, unknown>, object]> = [];
    WeakMap.prototype.set = function (this: WeakMap<object, unknown>, key: object): WeakMap<object, unknown> {
        captured.push([this, key]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any).apply(this, arguments as unknown as any[]);
    };
    try {
        run();
    } finally {
        WeakMap.prototype.set = original;
    }
    return captured;
};

describe('liveViews RAW_TARGET hatch', () => {
    test('building a 100-row read view inserts no proxy into any WeakMap registry', () => {
        const store = new Carburetor<ITree>(getTree(100));
        const views: object[] = [];
        const inserts = captureWeakMapSets(() => {
            const view = store.read((path: TPath) => {
                void path;
            });
            views.push(view);
            for (const row of view.rows) {
                views.push(row);
            }
        });

        expect(views).toHaveLength(101);
        const keys = new Set<object>(inserts.map(([, key]) => key));
        for (const view of views) {
            expect(keys.has(view)).toBe(false);
        }
    });

    test('readTarget and has recognize read proxies, draft proxies and native facades', () => {
        const data = getTree(3);
        const store = new Carburetor<ITree>(data);
        const recorder = (path: TPath): void => {
            void path;
        };
        const view = store.read(recorder);
        const rawRow = data.rows[1];

        expect(liveViews.readTarget(view)).toBe(data);
        expect(liveViews.readTarget(view.rows[1])).toBe(rawRow);
        expect(liveViews.has(view.rows[1])).toBe(true);
        expect(liveViews.has(rawRow)).toBe(false);

        store.update(draft => {
            const rowDraft = draft.rows[0];
            expect(liveViews.readTarget(rowDraft)).toBe(data.rows[0]);
            expect(liveViews.has(rowDraft)).toBe(true);
            draft.rows[0] = {n: 99};
            expect(liveViews.readTarget(draft.rows[0])).not.toBeUndefined();
        });
        expect(data.rows[0].n).toBe(99);

        const members = new Map<number, IRow>([[1, rawRow]]);
        const facade = liveViews.adaptNativeCollection(
            members, Reflect.get(view, PROXY_CACHE) as IProxyCache, data, 'rows'
        );
        expect(liveViews.readTarget(facade)).toBe(members);
        expect(liveViews.has(facade)).toBe(true);
        expect(Reflect.get(facade, RAW_TARGET)).toBe(members);
    });

    test('a foreign proxy whose get trap throws on the hatch reads as "not an engine view"', () => {
        const hostile = new Proxy({}, {
            get(_target, key): unknown {
                if (typeof key === 'symbol') {
                    throw new Error('no symbol reads');
                }

                return undefined;
            },
        });

        expect(liveViews.readTarget(hostile)).toBeUndefined();
        expect(liveViews.has(hostile)).toBe(false);
    });
});
