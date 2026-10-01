import {Carburetor, CarburetorHistory} from '@/Carburetor';

describe('effective writes survive a throwing patch observer', () => {
    class Store extends Carburetor<{x: number; item: Record<string, number>; items: number[]}> {
        public setX(value: number): void { this.update(d => { d.x = value; }); }
        public replaceItem(value: Record<string, number>): void { this.update(d => { d.item = value; }); }
        public append(index: number, value: number): void {
            this.update(d => { d.items[index] = value; });
        }
        public define(index: number, value: number): void {
            this.update(d => { Object.defineProperty(d.items, index, {
                value, writable: true, enumerable: true, configurable: true,
            }); });
        }
        public truncate(length: number): void { this.update(d => { d.items.length = length; }); }
        public remove(key: string): void { this.update(d => { delete d.item[key]; }); }
        public writeDraft(value: number): void { this.draft.x = value; this.emitUpdate(); }
        public publish(): void { this.emitUpdate(); }
        public publishRaw(value: number): void { this.data.x = value; this.emitUpdate(); }
    }
    const makeStore = (): Store => new Store({x: 0, item: {first: 1, middle: 2, last: 3}, items: [4, 5, 6]});

    test.each([new Error('observer failure'), undefined])(
        'retains scalar identity, publication and independent undo after throwing %s', original => {
            const store = makeStore();
            const first = new CarburetorHistory(store);
            const second = new CarburetorHistory(store);
            const seen: number[] = [];
            store.watch(d => d.x, next => { seen.push(next); });
            const detach = store.attachPatchListener({patch: () => { throw original; }});
            let caught = false;
            try { store.setX(2); } catch (error) {
                caught = true;
                expect(error).toBe(original);
            }
            expect(caught).toBe(true);
            expect(store.getData().x).toBe(2);
            expect(store.getVersion()).toBe(1);
            expect(seen).toEqual([2]);
            detach();
            expect(first.undo()).toBe(true);
            expect(store.getData().x).toBe(0);
            expect(second.canUndo()).toBe(true);
            first.disconnect();
            second.disconnect();
        }
    );

    test('reports every changed leaf of one replaced branch despite the first patch failing', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const seen: number[][] = [];
        store.watch(d => [d.item.first, d.item.middle, d.item.last], next => { seen.push(next); });
        const original = new Error('first patch');
        const detach = store.attachPatchListener({patch: () => { throw original; }});
        let caught: unknown;
        try { store.replaceItem({first: 10, middle: 20, last: 30}); }
        catch (error) { caught = error; }
        expect(caught).toBe(original);
        expect(store.getVersion()).toBe(1);
        expect(seen).toEqual([[10, 20, 30]]);
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData().item).toEqual({first: 1, middle: 2, last: 3});
        store.replaceItem({first: 11, middle: 21, last: 31});
        expect(history.undo()).toBe(true);
        expect(store.getData().item).toEqual({first: 1, middle: 2, last: 3});
        history.disconnect();
    });

    test('direct draft write is attributed when explicitly published after observer failure', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const seen: number[] = [];
        store.watch(d => d.x, next => { seen.push(next); });
        const original = new Error('draft');
        const detach = store.attachPatchListener({patch: () => { throw original; }});
        expect(() => store.writeDraft(2)).toThrow(original);
        expect(store.getVersion()).toBe(0);
        expect(store.getData().x).toBe(2);
        store.publish();
        expect(store.getVersion()).toBe(1);
        expect(seen).toEqual([2]);
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData().x).toBe(0);
        history.disconnect();
    });

    test.each(['assignment', 'definition'])('%s growth attributes index and implicit length', kind => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const indices: number[] = [];
        const lengths: number[] = [];
        store.watch(d => d.items[5], next => { indices.push(next); });
        store.watch(d => d.items.length, next => { lengths.push(next); });
        const original = new Error('growth');
        const detach = store.attachPatchListener({patch: () => { throw original; }});
        expect(() => kind === 'definition' ? store.define(5, 9) : store.append(5, 9)).toThrow(original);
        expect(store.getVersion()).toBe(1);
        expect(indices).toEqual([9]);
        expect(lengths).toEqual([6]);
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([4, 5, 6]);
        history.disconnect();
    });

    test('partial truncation records all removed indices and final length even when native write fails', () => {
        const items = [4, 5, 6, 7, 8];
        Object.defineProperty(items, '1', {configurable: false, value: 5, writable: true, enumerable: true});
        const store = new Store({x: 0, item: {}, items});
        const seen: Array<Array<number | undefined>> = [];
        store.watch(d => [d.items.length, d.items[3], d.items[4]], next => { seen.push(next); });
        store.attachPatchListener({patch: () => { throw undefined; }});
        let caught = false;
        try { store.truncate(0); } catch (error) {
            caught = true;
            expect(error).toBeUndefined();
        }
        expect(caught).toBe(true);
        expect(store.getData().items).toEqual([4, 5]);
        expect(store.getVersion()).toBe(1);
        expect(seen).toEqual([[2, undefined, undefined]]);
    });

    test.each(['replacement', 'restore', 'raw publish'])(
        '%s publishes effective data despite opaque observer failure', kind => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const seen: number[] = [];
        store.watch(d => d.x, next => { seen.push(next); });
        const original = new Error(kind);
        const detach = store.attachPatchListener({patch: () => { throw original; }});
        let caught: unknown;
        try {
            if (kind === 'replacement') store.setData({...store.getData(), x: 2});
            else if (kind === 'restore') store.restore({...store.getData(), x: 2});
            else store.publishRaw(2);
        } catch (error) { caught = error; }
        expect(caught).toBe(original);
        expect(store.getVersion()).toBe(1);
        expect(seen).toEqual([2]);
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData().x).toBe(0);
        history.disconnect();
    });

    test('detaching the failing observer during delivery leaves later leaf patches for history', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const original = new Error('detach');
        let calls = 0;
        let detach: () => void = () => {};
        detach = store.attachPatchListener({patch: () => {
            calls++;
            detach();
            throw original;
        }});
        expect(() => store.replaceItem({first: 4, middle: 5, last: 6})).toThrow(original);
        expect(calls).toBe(1);
        expect(store.getVersion()).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().item).toEqual({first: 1, middle: 2, last: 3});
        history.disconnect();
    });

    test('middle-key deletion retains order and undo despite a failing owned-replay signal', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        const keys: string[][] = [];
        store.watch(d => Object.keys(d.item), next => { keys.push(next); });
        const original = new Error('order');
        const detach = store.attachPatchListener({patch: () => { throw original; }});
        expect(() => store.remove('middle')).toThrow(original);
        expect(store.getVersion()).toBe(1);
        expect(keys).toEqual([['first', 'last']]);
        detach();
        expect(history.undo()).toBe(true);
        expect(Object.keys(store.getData().item)).toEqual(['first', 'middle', 'last']);
        history.disconnect();
    });

    test('custom restore producers retain the boolean exact-owned adoption contract', () => {
        type Row = {n: number};
        type State = {row: Row; map: Map<string, Row>};
        class CustomProducer extends Carburetor<State> {
            public replace(row: Row): void {
                this.setData({row, map: new Map([['row', row]])});
            }
            public restore(data: State): void {
                const owned = this.patchObservers?.ownRestore(data) === true;
                this.setData(owned ? data : {row: {n: data.row.n}, map: new Map(data.map)});
            }
        }

        const initialRow = {n: 1};
        const store = new CustomProducer({row: initialRow, map: new Map([['row', initialRow]])});
        const history = new CarburetorHistory(store);
        store.replace({n: 2});

        expect(history.undo()).toBe(true);
        expect(store.getData().row.n).toBe(1);
        expect(store.getData().map.get('row')).toBe(store.getData().row);
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().row.n).toBe(2);
        expect(store.getData().map.get('row')).toBe(store.getData().row);
        history.disconnect();
    });
});
