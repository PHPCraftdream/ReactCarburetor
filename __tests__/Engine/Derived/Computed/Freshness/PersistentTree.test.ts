import {rstest} from '@rstest/core';
import {Carburetor, computed} from '@/Carburetor';

interface IData {
    user: {name: string};
    extra: {n: number};
}

const getData = (): IData => ({user: {name: 'a'}, extra: {n: 1}});

class DataCarburetor extends Carburetor<IData> {
    public setName = (name: string) => {
        this.draft.user.name = name;

        this.emitUpdate();
    };

    public setExtra = (n: number) => {
        this.draft.extra.n = n;

        this.emitUpdate();
    };
}

describe('computed persistent read tree (R30-05)', () => {
    test('live elements keep their identity across recomputes', () => {
        const store = new DataCarburetor(getData());
        let runs = 0;
        const size = computed((read) => {
            const root = read(store);

            void root.user.name;
            runs++;

            return root;
        });

        size.subscribe(() => {});
        const first = size.get();

        store.setName('b');
        const second = size.get();

        expect(second).toBe(first);
        expect(runs).toEqual(2);
    });

    test('a late read through a view from before setData extends the current dependency', () => {
        const store = new DataCarburetor(getData());
        let runs = 0;
        const size = computed((read) => {
            const root = read(store);

            void root.user.name;
            runs++;

            return root;
        });

        size.subscribe(() => {});
        const first = size.get();

        store.setData({user: {name: 'z'}, extra: {n: 1}});
        expect(size.get()).not.toBe(first);
        expect(runs).toEqual(2);

        // Escape read: a path the body never reads, through the earlier recompute's view.
        void (first as unknown as IData).extra;

        // The extended path wakes the computed: the read landed in the current dependency.
        store.setExtra(2);
        expect(size.get()).not.toBeUndefined();
        expect(runs).toEqual(3);

        const snap = store.snapshot();
        store.setName('q');
        expect(size.get()).not.toBeUndefined();
        expect(runs).toEqual(4);

        store.restore(snap);
        expect(store.getData().user.name).toEqual('z');
        expect(runs).toEqual(5);
    });

    test('a conditional dependency follows the branch the body last took', () => {
        const store = new DataCarburetor(getData());
        const other = new DataCarburetor(getData());
        let useUser = true;
        const picked = computed((read) => (useUser ? read(store).user.name : read(other).extra.n));

        const seen: Array<string | number> = [];
        picked.subscribe(() => { seen.push(picked.get()); });
        expect(picked.get()).toEqual('a');

        useUser = false;
        store.setName('b');
        expect(picked.get()).toEqual(1);

        other.setExtra(9);
        expect(picked.get()).toEqual(9);

        useUser = true;
        other.setExtra(1);
        expect(picked.get()).toEqual('b');
    });
});


interface IWatchData {
    flag: boolean;
    a: number;
    b: number;
}

const getWatchData = (): IWatchData => ({flag: true, a: 1, b: 2});

class WatchCarburetor extends Carburetor<IWatchData> {
    public setFlag = (flag: boolean) => {
        this.draft.flag = flag;

        this.emitUpdate();
    };

    public setA = (a: number) => {
        this.draft.a = a;

        this.emitUpdate();
    };

    public setB = (b: number) => {
        this.draft.b = b;

        this.emitUpdate();
    };
}

describe('watch persistence (R30-05/R30-10)', () => {
    test('an unchanged read set does not re-file the subscription', () => {
        const store = new WatchCarburetor(getWatchData());
        const subscribe = rstest.spyOn(store, 'subscribe');
        const seen: Array<number> = [];
        const stop = store.watch((data) => (data.flag ? data.a : data.b), (next) => seen.push(next));

        expect(subscribe).toHaveBeenCalledTimes(1);

        store.setA(3);
        expect(seen).toEqual([3]);

        // Same paths read, value moved: the registration stays untouched.
        expect(subscribe).toHaveBeenCalledTimes(1);

        stop();
    });

    test('a moved read set is re-filed', () => {
        const store = new WatchCarburetor(getWatchData());
        const subscribe = rstest.spyOn(store, 'subscribe');
        const seen: Array<number> = [];
        const stop = store.watch((data) => (data.flag ? data.a : data.b), (next) => seen.push(next));

        store.setFlag(false);
        expect(seen).toEqual([2]);

        // The selector now reads `b`: the read set moved, so it is registered again.
        expect(subscribe).toHaveBeenCalledTimes(2);

        store.setB(5);
        expect(seen).toEqual([2, 5]);
        // And an unchanged set after the move still does not re-file.
        expect(subscribe).toHaveBeenCalledTimes(2);

        stop();
    });
});
