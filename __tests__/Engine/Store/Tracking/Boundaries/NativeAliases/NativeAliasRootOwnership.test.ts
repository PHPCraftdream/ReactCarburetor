/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from '@/Carburetor';

class Opaque { public readonly tag = 1; }
interface IRow { n: number; }
interface IState { native: Date | Opaque; row: IRow; spare: IRow; padding: IRow; }
class Store extends Carburetor<IState> {
    public change(fn: (draft: IState) => void): void { this.update(fn); }
}
const read = (store: Store): Set<string> => {
    const paths = new Set<string>();
    expect(store.read(path => paths.add(path)).native).toBe(store.getData().native);
    return paths;
};

describe('R43-S03 root-owned native alias answers', () => {
    test.each(['Date', 'opaque'])('%s negative answers refresh hidden own data only after topology', kind => {
        const native = kind === 'Date' ? new Date(1) : new Opaque();
        const store = new Store({native, row: {n: 1}, spare: {n: 0}, padding: {n: 0}});
        expect(read(store).has('row')).toBe(false);
        let getters = 0;
        Object.defineProperty(native, 'hidden', {value: store.getData().row});
        Object.defineProperty(native, Symbol('hidden'), {value: store.getData().row});
        Object.defineProperty(native, 'trap', {get() { getters++; return store.getData(); }});
        Object.defineProperty(native, Symbol('trap'), {get() { getters++; return store.getData(); }});
        expect(read(store).has('row')).toBe(false);
        store.change(d => { d.padding = {n: 1}; });
        const paths = read(store);
        expect(paths.has('row')).toBe(true);
        expect(paths.has('*')).toBe(false);
        expect(read(store)).toEqual(paths);
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads: paths});
        try {
            store.change(d => { d.spare.n++; });
            expect(wakes).toBe(0);
            store.change(d => { d.row.n++; });
            expect(wakes).toBe(1);
        } finally { store.unsubscribe(id); }
        expect(getters).toBe(0);
    });

    test('shared native answers stay root-local across alternation, replacement and moved aliases', () => {
        const native = new Date(1), row = {n: 1};
        Object.defineProperty(native, 'edge', {value: row});
        const a = new Store({native, row, spare: {n: 0}, padding: {n: 0}});
        const b = new Store({native, row: {n: 0}, spare: row, padding: {n: 0}});
        for (let i = 0; i < 3; i++) {
            expect(read(a).has('row')).toBe(true);
            expect(read(a).has('spare')).toBe(false);
            expect(read(b).has('spare')).toBe(true);
            expect(read(b).has('row')).toBe(false);
        }
        a.setData({native, row: {n: 0}, spare: row, padding: {n: 0}});
        expect(read(a).has('row')).toBe(false);
        expect(read(a).has('spare')).toBe(true);
        b.change(d => { d.spare = {n: 2}; });
        expect(read(b).has('spare')).toBe(false);
        expect(read(a).has('spare')).toBe(true);
    });

    test('hidden root backlink remains wildcard on cold and warm reads', () => {
        const native = new Opaque();
        const store = new Store({native, row: {n: 1}, spare: {n: 0}, padding: {n: 0}});
        Object.defineProperty(native, Symbol('root'), {value: store.getData()});
        expect(read(store).has('*')).toBe(true);
        const paths = read(store);
        expect(paths.has('*')).toBe(true);
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads: paths});
        try {
            store.change(d => { d.spare.n++; });
            expect(wakes).toBe(1);
        } finally { store.unsubscribe(id); }
    });
});
