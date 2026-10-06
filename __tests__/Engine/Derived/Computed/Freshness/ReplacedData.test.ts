import {Carburetor, computed} from '@/Carburetor';

interface IList {
    items: {a: {title: string}; b: {title: string}};
    other: number;
}

const initial = (): IList => ({items: {a: {title: 'A'}, b: {title: 'B'}}, other: 1});

/** The replacement a user installs: one leaf of the list differs, the rest is equal. */
const edited = (store: Carburetor<IList>): IList => {
    const next = store.snapshot() as IList;
    next.items.b.title = 'B2';

    return next;
};

describe('a live computed result after the store swaps its data object (R35-01)', () => {
    it('reads the replaced data through a result holding store data, observed', () => {
        const store = new Carburetor<IList>(initial());
        const items = computed((read) => read(store).items);
        items.subscribe(() => undefined);
        void items.get().a.title;

        store.setData(edited(store));

        expect(items.get().b.title).toBe('B2');
        expect(items.get().a.title).toBe('A');
    });

    it('reads the replaced data when nobody observes the computed', () => {
        const store = new Carburetor<IList>(initial());
        const items = computed((read) => read(store).items);
        void items.get().a.title;

        store.setData(edited(store));

        expect(items.get().b.title).toBe('B2');
    });

    it('reads the replaced root through a result that is the whole store view', () => {
        const store = new Carburetor<{x: number}>({x: 1});
        const root = computed((read) => read(store));
        root.subscribe(() => undefined);
        void root.get().x;

        store.setData({x: 5});

        expect(root.get().x).toBe(5);
    });

    it('follows fromJSON the same way', () => {
        const store = new Carburetor<IList>(initial());
        const items = computed((read) => read(store).items);
        items.subscribe(() => undefined);
        void items.get().a.title;

        store.fromJSON(edited(store));

        expect(items.get().b.title).toBe('B2');
    });

    it('follows a result built over another computed that holds store data', () => {
        const store = new Carburetor<IList>(initial());
        const items = computed((read) => read(store).items);
        const wrapped = computed((read) => ({inner: read(items)}));
        wrapped.subscribe(() => undefined);
        void wrapped.get().inner.a.title;

        store.setData(edited(store));

        expect(wrapped.get().inner.b.title).toBe('B2');
    });

    it('does not re-run a primitive result for a replacement that leaves its paths alone', () => {
        const store = new Carburetor<IList>(initial());
        let runs = 0;
        const other = computed((read) => {
            runs++;

            return read(store).other * 2;
        });
        other.subscribe(() => undefined);
        other.get();
        const before = runs;

        store.setData(edited(store));
        other.get();

        expect(runs).toBe(before);
    });

    it('keeps handing out the same result while the data object stays the same', () => {
        const store = new Carburetor<IList>(initial());
        const items = computed((read) => read(store).items);
        items.subscribe(() => undefined);
        const first = items.get();

        store.update((draft) => {
            draft.other = 2;
        });

        expect(items.get()).toBe(first);
    });
});
