import {Carburetor, TPath, TPathSet} from "@/Carburetor";

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

    public truncate = (length: number): void => {
        this.update((draft: IItemsData) => {
            draft.items.length = length;
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
}

describe('an array write on the array itself is attributed to the index it touched, not the whole array', () => {
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
