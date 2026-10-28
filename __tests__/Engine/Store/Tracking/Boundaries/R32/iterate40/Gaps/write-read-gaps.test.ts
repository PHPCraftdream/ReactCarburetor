import {Carburetor} from '@/Carburetor';
import {TPath} from '@/Carburetor/Models/Paths';

interface IData {
    branch: {value: number};
    rows: number[];
    optional?: number;
}

class GapStore extends Carburetor<IData> {
    public trackBranchOnly = (onRead: (path: TPath) => void): Set<TPath> => {
        const reads = new Set<TPath>();
        const view = this.read((path) => { onRead(path); reads.add(path); });
        void view.branch;
        return reads;
    };
    public mutateLeaf = (): void => this.update((draft) => { draft.branch.value = 3; });
    public remove = (): void => this.update((draft) => { delete draft.optional; });
    public define = (): void => this.update((draft) => {
        Object.defineProperty(draft, 'optional', {value: 7, configurable: true, enumerable: true, writable: true});
    });
    public grow = (): void => this.update((draft) => { draft.rows[4] = 5; });
    public replace = (): void => this.update((draft) => { draft.branch = {value: 2}; });
    public deleteBranch = (): void => this.update((draft) => { Reflect.deleteProperty(draft, 'branch'); });
}

const makeStore = (): GapStore => new GapStore({branch: {value: 1}, rows: [1, 2]});

describe('write/read tracking gaps', () => {
    test('delete and defineProperty update observable presence and enumeration', () => {
        const store = makeStore();
        const view = store.read(() => undefined);
        store.define();
        expect(view.optional).toBe(7);
        expect(Object.keys(view)).toContain('optional');
        store.remove();
        expect('optional' in view).toBe(false);
        expect(Object.keys(view)).not.toContain('optional');
    });

    test('array index growth publishes the new index, length, and key-set change', () => {
        const store = makeStore();
        const reads = new Set<TPath>();
        const view = store.read((path) => reads.add(path));
        expect([...view.rows]).toEqual([1, 2]);
        expect(Object.keys(view.rows)).toEqual(['0', '1']);
        let wakes = 0;
        const subscriptionId = store.subscribe(() => { wakes++; }, {id: 'array-reader', reads});
        store.grow();
        expect([...store.getData().rows]).toEqual([1, 2, undefined, undefined, 5]);
        expect(wakes).toBe(1);
        store.unsubscribe(subscriptionId);
    });

    test('branch replacement is visible while reads stay branch-precise', () => {
        const store = makeStore();
        const reads = new Set<TPath>();
        const view = store.read((path) => reads.add(path));
        expect(view.branch.value).toBe(1);
        expect(reads.has('branch.~p')).toBe(true);
        store.replace();
        expect(view.branch.value).toBe(2);
    });

    test('branch-only reads ignore leaf and same-kind replacement but wake on branch deletion', () => {
        const store = makeStore();
        const reads = store.trackBranchOnly((_path) => undefined);
        expect(reads).toEqual(new Set<TPath>(['branch.~p']));
        let wakes = 0;
        const subscriptionId = store.subscribe(() => { wakes++; }, {id: 'branch-only-reader', reads});
        store.mutateLeaf();
        expect(wakes).toBe(0);
        store.replace();
        expect(wakes).toBe(0);
        store.deleteBranch();
        expect(wakes).toBe(1);
        expect('branch' in store.read(() => undefined)).toBe(false);
        store.unsubscribe(subscriptionId);
    });

    test('frozen nested branches are refused in development without leaking a proxy invariant', () => {
        const environment = process.env.NODE_ENV;
        const branch = Object.freeze({value: 1});
        const data = Object.defineProperty({branch}, 'branch', {
            value: branch, configurable: false, enumerable: true, writable: false,
        });
        const store = new Carburetor(data);
        process.env.NODE_ENV = 'development';
        try {
            expect(() => store.read(() => undefined).branch).toThrow(/branch/);
        } finally {
            process.env.NODE_ENV = environment;
        }
    });
});
