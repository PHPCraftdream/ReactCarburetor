import {React, act, render, AntiHookComponent} from '../../support';
import {ListStore, begin, end, makeStore, measure} from './support';

const ROWS = 1000;

/** A list parent whose render and commit work is counted; `mode` picks useCarburetor or connect. */
const makeList = (store: ListStore, mode: 'track' | 'connect') => {
    const zero = {sets: 0, slices: 0, prunes: 0};
    const probe = {render: zero, commit: zero, renders: 0};

    class List extends AntiHookComponent {
        private readonly data = this.connect(() => store);

        render() {
            probe.renders++;
            begin();
            try {
                const {items, titles} = mode === 'track' ? this.useCarburetor(store) : this.data;
                return <ul>{items.map(row => <li key={row.id}>{titles ? row.title : ''}{row.owner.name}</li>)}</ul>;
            } finally {
                probe.render = end();
            }
        }

        componentDidUpdate(prevProps: Readonly<{}>) {
            probe.commit = measure(() => super.componentDidUpdate(prevProps));
        }
    }

    return {List, probe};
};

describe('a stable list re-render reuses the filed read set', () => {
    for (const mode of ['track', 'connect'] as const) {
        test(`${mode}: an unchanged read set builds no Set, slices nothing and does not re-subscribe`, () => {
            const store = makeStore(ROWS);
            const {List, probe} = makeList(store, mode);
            const {container, unmount} = render(<List/>);

            // The first update learns the raw recording; from then on the read set is stable.
            act(() => store.run(draft => { draft.items[1].title = 'warm'; }));
            const subscribes = store.subscribed.length;

            for (let round = 0; round < 3; round++) {
                act(() => store.run(draft => { draft.items[5].title = 'x' + round; }));

                expect(probe.render).toEqual({sets: 0, slices: 0, prunes: 0});
                expect(probe.commit).toEqual({sets: 0, slices: 0, prunes: 0});
            }
            expect(store.subscribed.length).toBe(subscribes);
            expect(container.querySelectorAll('li')[5].textContent).toBe('x2n5');
            expect(probe.renders).toBe(5);

            // The filed set still wakes the list for a row it reads.
            act(() => store.run(draft => { draft.items[999].owner.name = 'last'; }));
            expect(container.querySelectorAll('li')[999].textContent).toBe('t999last');
            unmount();
        });

        test(`${mode}: a branch switch builds the new set and re-files it`, () => {
            const store = makeStore(ROWS);
            const {List, probe} = makeList(store, mode);
            const {container, unmount} = render(<List/>);

            act(() => store.run(draft => { draft.items[1].title = 'warm'; }));
            act(() => store.run(draft => { draft.items[2].title = 'warm'; }));
            const subscribes = store.subscribed.length;

            act(() => store.run(draft => { draft.titles = false; }));

            expect(probe.render.sets + probe.commit.sets).toBeGreaterThan(0);
            expect(probe.commit.prunes).toBe(1);
            expect(store.subscribed.length).toBe(subscribes + 1);
            const filed = store.subscribed[store.subscribed.length - 1];
            expect(filed.has('items.3.owner.name')).toBe(true);
            expect(filed.has('items.3.title')).toBe(false);

            // A title write no longer reaches the list; a name write still does.
            const renders = probe.renders;
            act(() => store.run(draft => { draft.items[3].title = 'quiet'; }));
            expect(probe.renders).toBe(renders);
            act(() => store.run(draft => { draft.items[3].owner.name = 'loud'; }));
            expect(probe.renders).toBe(renders + 1);
            expect(container.querySelectorAll('li')[3].textContent).toBe('loud');

            // Switching back re-files the title paths.
            act(() => store.run(draft => { draft.titles = true; }));
            expect(store.subscribed[store.subscribed.length - 1].has('items.3.title')).toBe(true);
            act(() => store.run(draft => { draft.items[3].title = 'back'; }));
            expect(container.querySelectorAll('li')[3].textContent).toBe('backloud');
            unmount();
        });
    }
});
