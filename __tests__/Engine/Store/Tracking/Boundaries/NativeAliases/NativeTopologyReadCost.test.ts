/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from "@/Carburetor";

class FlatStamp {
    public constructor(public readonly ms: number) {}
}

class DayStamp {
    public readonly $d: Date;
    public readonly $x = {};

    public constructor(ms: number) {
        this.$d = new Date(ms);
    }
}

interface IState {
    items: {at: Date | FlatStamp | DayStamp}[];
    meta?: object;
}

class NativeReadStore extends Carburetor<IState> {
    public topology(): void {
        this.update(draft => { draft.meta = {}; });
    }
}

interface ICounts {
    sets: number;
    ownKeys: number;
    descriptors: number;
}

/** Counts only the synchronous read region, restoring globals even on failure. */
const countReads = (run: () => void): ICounts => {
    const OriginalSet = globalThis.Set;
    const ownKeys = Reflect.ownKeys;
    const descriptor = Reflect.getOwnPropertyDescriptor;
    const counts: ICounts = {sets: 0, ownKeys: 0, descriptors: 0};
    globalThis.Set = new Proxy(OriginalSet, {
        construct(target, args, newTarget) {
            counts.sets++;
            return Reflect.construct(target, args, newTarget);
        },
    });
    Reflect.ownKeys = target => {
        counts.ownKeys++;
        return ownKeys(target);
    };
    Reflect.getOwnPropertyDescriptor = (target, key) => {
        counts.descriptors++;
        return descriptor(target, key);
    };
    try {
        run();
    } finally {
        globalThis.Set = OriginalSet;
        Reflect.ownKeys = ownKeys;
        Reflect.getOwnPropertyDescriptor = descriptor;
    }
    return counts;
};

/** Warms one persistent public read view before an unrelated topology write. */
const leafReads = (
    size: number, make: (index: number) => Date | FlatStamp | DayStamp, all: boolean
): {counts: ICounts; sum: number} => {
    const store = new NativeReadStore({items: Array.from({length: size}, (_, i) => ({at: make(i)}))});
    const view = store.read(() => undefined);
    let sum = 0;
    const read = (): void => {
        sum = 0;
        for (let i = 0; i < (all ? size : 1); i++) {
            const at = view.items[i].at;
            sum += at instanceof Date ? at.getTime() : at instanceof FlatStamp ? at.ms : at.$d.getTime();
        }
    };
    read();
    store.topology();
    return {counts: countReads(read), sum};
};

describe('R39-03 native reads after unrelated topology', () => {
    test('the counters observe Set construction and both reflection operations', () => {
        const counts = countReads(() => {
            const value = new Set<number>();
            Reflect.ownKeys(value);
            Reflect.getOwnPropertyDescriptor(value, 'size');
        });
        expect(counts).toEqual({sets: 1, ownKeys: 1, descriptors: 1});
    });

    test.each(['Date', 'flat instance'])('%s: 1000 warmed leaves allocate no Sets and call no Reflect.ownKeys (key arrays still allocate)', kind => {
        const result = leafReads(1000, i => kind === 'Date' ? new Date(i) : new FlatStamp(i), true);
        expect(result.sum).toBe(499500);
        expect(result.counts.sets).toBe(0);
        expect(result.counts.ownKeys).toBe(0);
    });

    test('stage2: one dayjs-like read has the same descriptor cost at 1k/10k after topology', () => {
        const small = leafReads(1000, i => new DayStamp(i), false);
        const large = leafReads(10000, i => new DayStamp(i), false);
        expect(small.sum).toBe(0);
        expect(large.sum).toBe(0);
        expect(large.counts.descriptors).toBe(small.counts.descriptors);
    });
});
