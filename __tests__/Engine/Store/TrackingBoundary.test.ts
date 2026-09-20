// This whole file is about the untrackable boundary, so it mutates Maps, Sets and Dates through
// draft on purpose. The rule that forbids that is right; these tests prove the engine behaves the
// way the rule's message claims.
/* oxlint-disable carburetor/no-untrackable-draft-mutation */
/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor, isTrackable, TPath} from "@/Carburetor";

class Profile {
    public name: string = 'anonymous';
}

interface IMixedData {
    plain: {count: number};
    list: number[];
    when: Date;
    index: Map<string, number>;
    profile: Profile;
}

const getData = (): IMixedData => ({
    plain: {count: 0},
    list: [1],
    when: new Date(0),
    index: new Map<string, number>([['a', 1]]),
    profile: new Profile(),
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

    /** Reaching for a Map through draft: the proxy cannot see the mutation itself. */
    public mutateIndexThroughDraft = (key: string, value: number) => {
        this.draft.index.set(key, value);

        this.emitUpdate();
    };

    public mutateWhenThroughDraft = (time: number) => {
        this.update((draft: IMixedData) => {
            draft.when.setTime(time);
        });
    };

    /** A class instance is not trackable either, so its fields are written directly. */
    public renameProfileThroughDraft = (name: string) => {
        this.update((draft: IMixedData) => {
            draft.profile.name = name;
        });
    };

    /** Reading through draft, not writing: nobody should be woken by this. */
    public copyList = (): number[] => {
        const copy = [...this.draft.list];

        this.emitUpdate();

        return copy;
    };

    /** A define bypasses the set trap, so it needs a trap of its own. */
    public defineCountThroughDraft = (count: number) => {
        this.update((draft: IMixedData) => {
            Object.defineProperty(draft.plain, 'count', {
                value: count,
                enumerable: true,
                writable: true,
                configurable: true,
            });
        });
    };
}

const TAG: unique symbol = Symbol('tag');

interface ISymbolData {
    a: number;
    [TAG]?: number;
}

/** A symbol key has no string path, so a write through one has nothing to be precise about. */
class SymbolCarburetor extends Carburetor<ISymbolData> {
    public tag = (value: number) => {
        this.update((draft: ISymbolData) => {
            draft[TAG] = value;
        });
    };

    public untag = () => {
        this.update((draft: ISymbolData) => {
            delete draft[TAG];
        });
    };
}

/** The store itself can be untrackable: then there is no path to be precise about. */
class CounterMapCarburetor extends Carburetor<Map<string, number>> {
    public setKey = (key: string, value: number) => {
        this.update((draft: Map<string, number>) => {
            draft.set(key, value);
        });
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

        carburetor.subscribe(() => countReader++, {id: 'count-reader', reads: new Set<TPath>(['plain.count'])});

        // The changed paths are unknown here, so the fallback is to treat all of them as changed.
        carburetor.mutateIndexInPlace('b', 2);
        expect(countReader).toEqual(1);

        // Replacing the value keeps the usual precision.
        carburetor.replaceIndex(new Map<string, number>([['c', 3]]));
        expect(countReader).toEqual(1);

        carburetor.bumpCount();
        expect(countReader).toEqual(2);
    });

    test('mutating a Map reached through draft still reaches its subscribers', () => {
        const carburetor = new MixedCarburetor(getData());
        let indexReader = 0;
        let countReader = 0;

        carburetor.subscribe(() => indexReader++, {id: 'index-reader', reads: new Set<TPath>(['index'])});
        carburetor.subscribe(() => countReader++, {id: 'count-reader', reads: new Set<TPath>(['plain.count'])});

        carburetor.mutateIndexThroughDraft('b', 2);

        expect(carburetor.getData().index.get('b')).toEqual(2);
        // Reaching for an untrackable value through draft counts as writing it: the
        // mutation itself is invisible, so the path it came from is the honest answer.
        expect(indexReader).toEqual(1);
        // Precision is kept: this is not a fallback to invalidating the whole store.
        expect(countReader).toEqual(0);
    });

    test('mutating a Date and a class instance through draft reaches their subscribers', () => {
        const carburetor = new MixedCarburetor(getData());
        let whenReader = 0;
        let profileReader = 0;
        let countReader = 0;

        carburetor.subscribe(() => whenReader++, {id: 'when-reader', reads: new Set<TPath>(['when'])});
        carburetor.subscribe(() => profileReader++, {id: 'profile-reader', reads: new Set<TPath>(['profile'])});
        carburetor.subscribe(() => countReader++, {id: 'count-reader', reads: new Set<TPath>(['plain.count'])});

        carburetor.mutateWhenThroughDraft(1000);
        expect(carburetor.getData().when.getTime()).toEqual(1000);
        expect(whenReader).toEqual(1);
        expect(profileReader).toEqual(0);

        carburetor.renameProfileThroughDraft('Marat');
        expect(carburetor.getData().profile.name).toEqual('Marat');
        expect(profileReader).toEqual(1);
        expect(whenReader).toEqual(1);
        expect(countReader).toEqual(0);
    });

    test('a component reading a Map re-renders when it is mutated through draft', () => {
        const carburetor = new MixedCarburetor(getData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const size = data.index.size;
        let renders = 0;

        expect(size).toEqual(1);
        carburetor.subscribe(() => renders++, {id: 'component', reads});

        carburetor.mutateIndexThroughDraft('b', 2);

        expect(renders).toEqual(1);
    });

    test('defining a property through draft is a write like any other', () => {
        const carburetor = new MixedCarburetor(getData());
        let countReader = 0;
        let indexReader = 0;

        carburetor.subscribe(() => countReader++, {id: 'count-reader', reads: new Set<TPath>(['plain.count'])});
        carburetor.subscribe(() => indexReader++, {id: 'index-reader', reads: new Set<TPath>(['index'])});

        carburetor.defineCountThroughDraft(7);

        expect(carburetor.getData().plain.count).toEqual(7);
        expect(countReader).toEqual(1);
        expect(indexReader).toEqual(0);
    });

    test('an untrackable store invalidates everything when it is written', () => {
        const carburetor = new CounterMapCarburetor(new Map<string, number>([['a', 1]]));
        let reader = 0;

        carburetor.subscribe(() => reader++, {id: 'reader', reads: new Set<TPath>(['whatever'])});

        carburetor.setKey('b', 2);

        expect(carburetor.getData().get('b')).toEqual(2);
        expect(reader).toEqual(1);
    });

    test('a write under a symbol key invalidates everything', () => {
        const carburetor = new SymbolCarburetor({a: 0});
        let reader = 0;

        carburetor.subscribe(() => reader++, {id: 'a-reader', reads: new Set<TPath>(['a'])});

        carburetor.tag(1);
        expect(carburetor.getData()[TAG]).toEqual(1);
        expect(reader).toEqual(1);

        carburetor.untag();
        expect(TAG in carburetor.getData()).toBeFalsy();
        expect(reader).toEqual(2);
    });

    test('iterating an array through draft is not a write', () => {
        const carburetor = new MixedCarburetor(getData());
        let countReader = 0;

        carburetor.subscribe(() => countReader++, {id: 'count-reader', reads: new Set<TPath>(['plain.count'])});

        // Spreading reaches for Symbol.iterator; a protocol lookup must not count as a write.
        carburetor.copyList();

        expect(countReader).toEqual(0);
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
