import {Carburetor, isTrackable, TPath} from "../lib/src/Carburetor";

interface IMixedData {
    plain: {count: number};
    list: number[];
    when: Date;
    index: Map<string, number>;
}

const getData = (): IMixedData => ({
    plain: {count: 0},
    list: [1],
    when: new Date(0),
    index: new Map<string, number>([['a', 1]]),
});

class MixedCarburetor extends Carburetor<IMixedData> {
    public bumpCount = () => {
        this.draft.plain.count++;

        this.emitUpdate();
    };

    /** Mutating a Map in place is invisible to tracking — the documented boundary. */
    public mutateIndexInPlace = (key: string, value: number) => {
        this.data.index.set(key, value);

        this.emitUpdate();
    };

    /** The supported way to change a non-plain value: replace it. */
    public replaceIndex = (next: Map<string, number>) => {
        this.draft.index = next;

        this.emitUpdate();
    };
}

describe('tracking boundary', () => {
    test('only plain objects and arrays are trackable', () => {
        expect(isTrackable({})).toBeTruthy();
        expect(isTrackable([])).toBeTruthy();
        expect(isTrackable(new Date(0))).toBeFalsy();
        expect(isTrackable(new Map())).toBeFalsy();
        expect(isTrackable(new Set())).toBeFalsy();
        expect(isTrackable(null)).toBeFalsy();
        expect(isTrackable(1)).toBeFalsy();
        expect(isTrackable('a')).toBeFalsy();
    });

    test('non-plain values are handed over as they are, and reading one is a leaf read', () => {
        const carburetor = new MixedCarburetor(getData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));

        expect(data.when).toBe(carburetor.getData().when);
        expect(data.index).toBe(carburetor.getData().index);
        expect(reads.has('when')).toBeTruthy();
        expect(reads.has('index')).toBeTruthy();
    });

    test('mutating a Map in place invalidates everything instead of its own path', () => {
        const carburetor = new MixedCarburetor(getData());
        let countReader = 0;

        carburetor.subscribe(() => countReader++, 'count-reader', new Set<TPath>(['plain.count']));

        // The changed paths are unknown here, so the fallback is to treat all of them as changed.
        carburetor.mutateIndexInPlace('b', 2);
        expect(countReader).toEqual(1);

        // Replacing the value keeps the usual precision.
        carburetor.replaceIndex(new Map<string, number>([['c', 3]]));
        expect(countReader).toEqual(1);

        carburetor.bumpCount();
        expect(countReader).toEqual(2);
    });

    test('a snapshot copies plain data and shares the rest', () => {
        const carburetor = new MixedCarburetor(getData());
        const taken = carburetor.snapshot();

        expect(taken.plain).not.toBe(carburetor.getData().plain);
        expect(taken.list).not.toBe(carburetor.getData().list);
        expect(taken.when).toBe(carburetor.getData().when);
        expect(taken.index).toBe(carburetor.getData().index);
    });
});
