import {Carburetor} from "@/Carburetor";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {spawnSync} from "node:child_process";

interface IItemsData {
    items: number[];
}

const getItemsData = (): IItemsData => ({items: [10, 20, 30]});

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

class ItemsCarburetor extends Carburetor<IItemsData> {
    public push = (value: number): void => {
        this.update((draft: IItemsData) => {
            draft.items.push(value);
        });
    };

    public setIndex = (index: number, value: number): void => {
        this.update((draft: IItemsData) => {
            draft.items[index] = value;
        });
    };

    public writeDraftIndex = (index: number, value: number): void => {
        // oxlint-disable-next-line carburetor/require-emit-after-draft-write
        this.draft.items[index] = value;
    };

    public truncate = (length: number): void => {
        this.update((draft: IItemsData) => {
            draft.items.length = length;
        });
    };

    public setLength = (value: unknown): void => {
        this.update((draft: IItemsData) => {
            (draft.items as unknown as {length: unknown}).length = value;
        });
    };

    public defineLength = (descriptor: PropertyDescriptor): void => {
        this.update((draft: IItemsData) => {
            Object.defineProperty(draft.items, 'length', descriptor);
        });
    };

    public pop = (): void => {
        this.update((draft: IItemsData) => {
            draft.items.pop();
        });
    };

    public shift = (): void => {
        this.update((draft: IItemsData) => {
            draft.items.shift();
        });
    };

    public spliceOut = (start: number, count: number): void => {
        this.update((draft: IItemsData) => {
            draft.items.splice(start, count);
        });
    };

    public sortAscending = (): void => {
        this.update((draft: IItemsData) => {
            draft.items.sort((a, b) => a - b);
        });
    };

    public deleteInheritedSymbol = (): void => {
        this.update((draft: IItemsData) => {
            delete (draft.items as unknown as Record<symbol, unknown>)[Symbol.iterator];
        });
    };
}

describe('an array write on the array itself is attributed to the index it touched, not the whole array', () => {
    test('deleting an inherited array symbol is a no-op', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        const versionBefore = carburetor.getVersion();

        carburetor.deleteInheritedSymbol();

        expect(carburetor.getVersion()).toEqual(versionBefore);
        expect(carburetor.getData().items).toEqual([10, 20, 30]);
    });

    test('push wakes a reader of the new index and a reader of length, not a reader of an untouched index', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let newIndexWakes = 0;
        let lengthWakes = 0;
        let untouchedWakes = 0;

        carburetor.subscribe(() => newIndexWakes++, {id: 'new-index', reads: readsOf('items.3')});
        carburetor.subscribe(() => lengthWakes++, {id: 'length', reads: readsOf('items.length')});
        carburetor.subscribe(() => untouchedWakes++, {id: 'untouched', reads: readsOf('items.0')});

        carburetor.push(40);

        expect(carburetor.getData().items).toEqual([10, 20, 30, 40]);
        expect(newIndexWakes).toEqual(1);
        expect(lengthWakes).toEqual(1);
        expect(untouchedWakes).toEqual(0);
    });

    test('assigning one index wakes only that index, not a sibling', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let indexWakes = 0;
        let siblingWakes = 0;

        carburetor.subscribe(() => indexWakes++, {id: 'i1', reads: readsOf('items.1')});
        carburetor.subscribe(() => siblingWakes++, {id: 'i0', reads: readsOf('items.0')});

        carburetor.setIndex(1, 99);

        expect(carburetor.getData().items).toEqual([10, 99, 30]);
        expect(indexWakes).toEqual(1);
        expect(siblingWakes).toEqual(0);
    });

    test('pop deletes the removed index precisely and shrinks length, waking neither survivor', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let removedWakes = 0;
        let survivorWakes = 0;
        let lengthWakes = 0;

        carburetor.subscribe(() => removedWakes++, {id: 'removed', reads: readsOf('items.2')});
        carburetor.subscribe(() => survivorWakes++, {id: 'survivor', reads: readsOf('items.0')});
        carburetor.subscribe(() => lengthWakes++, {id: 'length', reads: readsOf('items.length')});

        carburetor.pop();

        expect(carburetor.getData().items).toEqual([10, 20]);
        expect(removedWakes).toEqual(1);
        expect(survivorWakes).toEqual(0);
        expect(lengthWakes).toEqual(1);
    });

    test('shift deletes and re-indexes precisely: every remaining index that actually moved wakes', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let index0Wakes = 0;
        let index1Wakes = 0;

        carburetor.subscribe(() => index0Wakes++, {id: 'i0', reads: readsOf('items.0')});
        carburetor.subscribe(() => index1Wakes++, {id: 'i1', reads: readsOf('items.1')});

        carburetor.shift();

        // [10, 20, 30] -> [20, 30]: index 0 now holds what index 1 held, index 1 now holds
        // what index 2 held — both positions changed value, so both wake.
        expect(carburetor.getData().items).toEqual([20, 30]);
        expect(index0Wakes).toEqual(1);
        expect(index1Wakes).toEqual(1);
    });

    test('splicing out the middle element wakes the shifted tail, not the untouched head', () => {
        const carburetor = new ItemsCarburetor({items: [10, 20, 30, 40]});
        let headWakes = 0;
        let removedWakes = 0;
        let tailWakes = 0;

        carburetor.subscribe(() => headWakes++, {id: 'head', reads: readsOf('items.0')});
        carburetor.subscribe(() => removedWakes++, {id: 'removed', reads: readsOf('items.3')});
        carburetor.subscribe(() => tailWakes++, {id: 'tail', reads: readsOf('items.2')});

        carburetor.spliceOut(1, 1);

        expect(carburetor.getData().items).toEqual([10, 30, 40]);
        expect(headWakes).toEqual(0);
        // Index 2 now holds what index 3 held before, and index 3 (the old length's last slot)
        // is deleted: both are recorded precisely.
        expect(tailWakes).toEqual(1);
        expect(removedWakes).toEqual(1);
    });

    test('a direct length write that shrinks the array wakes every removed index, precisely', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let index0Wakes = 0;
        let index1Wakes = 0;
        let index2Wakes = 0;
        let lengthWakes = 0;

        carburetor.subscribe(() => index0Wakes++, {id: 'i0', reads: readsOf('items.0')});
        carburetor.subscribe(() => index1Wakes++, {id: 'i1', reads: readsOf('items.1')});
        carburetor.subscribe(() => index2Wakes++, {id: 'i2', reads: readsOf('items.2')});
        carburetor.subscribe(() => lengthWakes++, {id: 'length', reads: readsOf('items.length')});

        carburetor.truncate(0);

        expect(carburetor.getData().items).toEqual([]);
        expect(index0Wakes).toEqual(1);
        expect(index1Wakes).toEqual(1);
        expect(index2Wakes).toEqual(1);
        expect(lengthWakes).toEqual(1);
    });

    test('a length write that only shrinks part of the array leaves the kept indices untouched', () => {
        const carburetor = new ItemsCarburetor({items: [10, 20, 30, 40, 50]});
        let keptWakes = 0;
        let removedWakes = 0;

        carburetor.subscribe(() => keptWakes++, {id: 'kept', reads: readsOf('items.1')});
        carburetor.subscribe(() => removedWakes++, {id: 'removed', reads: readsOf('items.3')});

        carburetor.truncate(3);

        expect(carburetor.getData().items).toEqual([10, 20, 30]);
        expect(keptWakes).toEqual(0);
        expect(removedWakes).toEqual(1);
    });

    test('a length write that grows the array records only length, no index', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        let index5Wakes = 0;
        let lengthWakes = 0;

        carburetor.subscribe(() => index5Wakes++, {id: 'i5', reads: readsOf('items.5')});
        carburetor.subscribe(() => lengthWakes++, {id: 'length', reads: readsOf('items.length')});

        carburetor.truncate(6);

        expect(carburetor.getData().items.length).toEqual(6);
        expect(index5Wakes).toEqual(0);
        expect(lengthWakes).toEqual(1);
    });

    test('sorting wakes only the indices whose occupant actually changed', () => {
        const bValue = 20;
        const carburetor = new ItemsCarburetor({items: [40, bValue, 10, 30]});
        let index0Wakes = 0;
        let index1Wakes = 0;
        let index2Wakes = 0;
        let index3Wakes = 0;

        carburetor.subscribe(() => index0Wakes++, {id: 'i0', reads: readsOf('items.0')});
        carburetor.subscribe(() => index1Wakes++, {id: 'i1', reads: readsOf('items.1')});
        carburetor.subscribe(() => index2Wakes++, {id: 'i2', reads: readsOf('items.2')});
        carburetor.subscribe(() => index3Wakes++, {id: 'i3', reads: readsOf('items.3')});

        carburetor.sortAscending();

        // 20 is already the second-smallest and a primitive equal to itself, so whichever
        // index ends up holding it writes the SameValue it already had — a genuine no-op.
        expect(carburetor.getData().items).toEqual([10, 20, 30, 40]);
        expect(index1Wakes).toEqual(0);
        expect(index0Wakes).toEqual(1);
        expect(index2Wakes).toEqual(1);
        expect(index3Wakes).toEqual(1);
    });
});

describe('native array length writes', () => {
    test.each([-1, 1.5, Infinity, NaN, 0x100000000, undefined, 1n, Symbol('length')])(
        'rejects %s without publishing a ghost write', (value) => {
            const store = new ItemsCarburetor(getItemsData());
            let wakes = 0;
            let patches = 0;
            store.subscribe(() => wakes++, {id: 'all'});
            store.attachPatchListener({patch: () => patches++});

            expect(() => store.setLength(value)).toThrow();
            expect(store.getData().items).toEqual([10, 20, 30]);
            expect(store.getVersion()).toBe(0);
            expect(wakes).toBe(0);
            expect(patches).toBe(0);
        }
    );

    test('guarded invalid length assignment', () => {
        const program = `
            const {Carburetor} = require('./dist/cjs/Carburetor/index.js');
            class Store extends Carburetor {
                setLength(value) { this.update(draft => { draft.items.length = value; }); }
            }
            for (const value of [-Infinity, -1000000000]) {
                const store = new Store({items: [10, 20, 30]});
                let wakes = 0;
                let patches = 0;
                store.subscribe(() => wakes++);
                store.attachPatchListener({patch: () => patches++});
                let rejected = false;
                try { store.setLength(value); }
                catch (error) { rejected = error instanceof RangeError; }
                if (!rejected || store.getData().items.length !== 3
                    || store.getVersion() !== 0 || wakes !== 0 || patches !== 0) {
                    throw new Error('Invalid length changed the store or failed to reject');
                }
            }
        `;
        const child = spawnSync(process.execPath, ['-e', program], {
            cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
        });

        if (child.error || child.status !== 0) {
            throw new Error(`Guarded length test failed: ${child.error?.message || child.stderr || child.stdout}`);
        }
    }, 20_000);

    test('coerces an object twice, accepts strings and -0, and rejects differing conversions', () => {
        const store = new ItemsCarburetor(getItemsData());
        let calls = 0;

        store.setLength({valueOf: () => { calls++; return 2; }});
        expect(calls).toBe(2);
        expect(store.getData().items).toEqual([10, 20]);

        store.setLength('1');
        expect(store.getData().items).toEqual([10]);
        store.setLength(true);
        expect(store.getData().items).toEqual([10]);
        store.setLength(null);
        expect(store.getData().items).toEqual([]);
        store.setLength(-0);
        expect(store.getData().items).toEqual([]);

        const version = store.getVersion();
        calls = 0;
        expect(() => store.setLength({valueOf: () => ++calls})).toThrow(RangeError);
        expect(calls).toBe(2);
        expect(store.getVersion()).toBe(version);
    });

    test('a rejected conversion still publishes a real write made during coercion', () => {
        const store = new ItemsCarburetor(getItemsData());
        let wakes = 0;
        let calls = 0;
        store.subscribe(() => wakes++, {id: 'first', reads: readsOf('items.0')});

        expect(() => store.setLength({valueOf: () => {
            if (++calls === 1) {
                store.writeDraftIndex(0, 99);
            }

            return calls;
        }})).toThrow(RangeError);

        expect(calls).toBe(2);
        expect(store.getData().items).toEqual([99, 20, 30]);
        expect(store.getVersion()).toBe(1);
        expect(wakes).toBe(1);
    });

    test('non-writable length fails without publication; partial truncation publishes only actual deletions', () => {
        const fixed = [10, 20, 30];
        Object.defineProperty(fixed, 'length', {writable: false});
        const fixedStore = new ItemsCarburetor({items: fixed});
        let fixedWakes = 0;
        let fixedPatches = 0;
        fixedStore.subscribe(() => fixedWakes++, {id: 'fixed'});
        fixedStore.attachPatchListener({patch: () => fixedPatches++});
        expect(() => fixedStore.truncate(2)).toThrow(TypeError);
        expect(fixedStore.getVersion()).toBe(0);
        expect(fixedWakes).toBe(0);
        expect(fixedPatches).toBe(0);

        let coercions = 0;
        expect(() => fixedStore.setLength({valueOf: () => { coercions++; return 2; }})).toThrow(TypeError);
        expect(() => fixedStore.setLength({valueOf: () => { coercions++; throw new Error('coerced'); }}))
            .toThrow(TypeError);
        expect(() => fixedStore.setLength(-1)).toThrow(TypeError);
        expect(coercions).toBe(0);
        expect(fixedStore.getVersion()).toBe(0);
        expect(fixedWakes).toBe(0);
        expect(fixedPatches).toBe(0);

        const items = [10, 20, 30, 40];
        Object.defineProperty(items, '1', {value: 20, writable: true, enumerable: true, configurable: false});
        const store = new ItemsCarburetor({items});
        let kept = 0;
        let removed = 0;
        let absent = 0;
        let length = 0;
        store.subscribe(() => kept++, {id: 'kept', reads: readsOf('items.1')});
        store.subscribe(() => removed++, {id: 'removed', reads: readsOf('items.3')});
        store.subscribe(() => absent++, {id: 'absent', reads: readsOf('items.8')});
        store.subscribe(() => length++, {id: 'length', reads: readsOf('items.length')});

        expect(() => store.truncate(0)).toThrow(TypeError);
        expect(store.getData().items).toEqual([10, 20]);
        expect(store.getVersion()).toBe(1);
        expect(kept).toBe(0);
        expect(removed).toBe(1);
        expect(absent).toBe(0);
        expect(length).toBe(1);
    });

    test('defineProperty length truncates stored indices and wakes key readers', () => {
        const store = new ItemsCarburetor(getItemsData());
        const keyReads = new Set<TPath>();
        Object.keys(store.read((path) => keyReads.add(path)).items);
        let removed = 0;
        let kept = 0;
        let keys = 0;
        let length = 0;
        store.subscribe(() => removed++, {id: 'removed', reads: readsOf('items.2')});
        store.subscribe(() => kept++, {id: 'kept', reads: readsOf('items.0')});
        store.subscribe(() => keys++, {id: 'keys', reads: keyReads});
        store.subscribe(() => length++, {id: 'length', reads: readsOf('items.length')});

        store.defineLength({value: 1, writable: false});

        expect(store.getData().items).toEqual([10]);
        expect(Object.getOwnPropertyDescriptor(store.getData().items, 'length')?.writable).toBe(false);
        expect(removed).toBe(1);
        expect(kept).toBe(0);
        expect(keys).toBe(1);
        expect(length).toBe(1);
    });

    test('defineProperty length no-op and rejected value publish nothing', () => {
        const store = new ItemsCarburetor(getItemsData());
        let wakes = 0;
        let patches = 0;
        store.subscribe(() => wakes++, {id: 'all'});
        store.attachPatchListener({patch: () => patches++});

        store.defineLength({});
        expect(() => store.defineLength({value: -1})).toThrow(RangeError);
        expect(() => store.defineLength({value: -Infinity})).toThrow(RangeError);
        expect(store.getData().items).toEqual([10, 20, 30]);
        expect(store.getVersion()).toBe(0);
        expect(wakes).toBe(0);
        expect(patches).toBe(0);
    });

    test('defineProperty coerces before testing non-writable length', () => {
        const items = [10, 20, 30];
        Object.defineProperty(items, 'length', {writable: false});
        const store = new ItemsCarburetor({items});
        let calls = 0;
        let patches = 0;
        store.attachPatchListener({patch: () => patches++});

        expect(() => store.defineLength({value: {valueOf: () => { calls++; return -1; }}}))
            .toThrow(RangeError);
        expect(calls).toBe(2);
        expect(() => store.defineLength({value: 2})).toThrow(TypeError);
        expect(store.getData().items).toEqual([10, 20, 30]);
        expect(store.getVersion()).toBe(0);
        expect(patches).toBe(0);
    });

    test('defineProperty length partial refusal publishes actual deletions', () => {
        const items = [10, 20, 30, 40];
        Object.defineProperty(items, '1', {value: 20, writable: true, enumerable: true, configurable: false});
        const store = new ItemsCarburetor({items});
        const keyReads = new Set<TPath>();
        Object.keys(store.read((path) => keyReads.add(path)).items);
        let removed = 0;
        let kept = 0;
        let keys = 0;
        let length = 0;
        store.subscribe(() => removed++, {id: 'removed', reads: readsOf('items.3')});
        store.subscribe(() => kept++, {id: 'kept', reads: readsOf('items.1')});
        store.subscribe(() => keys++, {id: 'keys', reads: keyReads});
        store.subscribe(() => length++, {id: 'length', reads: readsOf('items.length')});

        expect(() => store.defineLength({value: 0})).toThrow(TypeError);
        expect(store.getData().items).toEqual([10, 20]);
        expect(store.getVersion()).toBe(1);
        expect(removed).toBe(1);
        expect(kept).toBe(0);
        expect(keys).toBe(1);
        expect(length).toBe(1);
    });

    test('sparse truncation wakes only stored removed indices and key readers', () => {
        const items: number[] = [10];
        items[50_000] = 50;
        items.length = 100_000;
        const store = new ItemsCarburetor({items});
        const reads = new Set<TPath>();
        Object.keys(store.read((path) => reads.add(path)).items);
        let present = 0;
        let absent = 0;
        let keys = 0;
        store.subscribe(() => present++, {id: 'present', reads: readsOf('items.50000')});
        store.subscribe(() => absent++, {id: 'absent', reads: readsOf('items.80000')});
        store.subscribe(() => keys++, {id: 'keys', reads});

        store.truncate(1);

        expect(store.getData().items).toEqual([10]);
        expect(present).toBe(1);
        expect(absent).toBe(0);
        expect(keys).toBe(1);
    });
});

describe('R16-01: an enumerator of an array wakes on push and pop, not on a same-length index write', () => {
    test('Object.keys(arr) wakes on push, and on pop, not on assigning an existing index', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.items)).toEqual(['0', '1', '2']);
        expect(reads.has('items.~k')).toBe(true);
        expect(reads.has('items')).toBe(false);

        carburetor.subscribe(() => wakes++, {id: 'keys-reader', reads});

        // The key set is unchanged: index 0 already exists.
        carburetor.setIndex(0, 99);
        expect(wakes).toEqual(0);

        carburetor.push(40);
        expect(wakes).toEqual(1);

        carburetor.pop();
        expect(wakes).toEqual(2);
    });

    test('Object.keys(arr) wakes on a length write that truncates indices out of the key set', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.items)).toEqual(['0', '1', '2']);

        carburetor.subscribe(() => wakes++, {id: 'keys-reader', reads});

        carburetor.truncate(1);

        expect(carburetor.getData().items).toEqual([10]);
        expect(wakes).toEqual(1);
    });

    test('a length write that only grows the array does not wake an enumerator: no index becomes own', () => {
        const carburetor = new ItemsCarburetor(getItemsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.items)).toEqual(['0', '1', '2']);

        carburetor.subscribe(() => wakes++, {id: 'keys-reader', reads});

        carburetor.truncate(6);

        expect(carburetor.getData().items.length).toEqual(6);
        expect(wakes).toEqual(0);
    });
});
