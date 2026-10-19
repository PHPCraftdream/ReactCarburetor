import {useCarburetorValue} from '@/Interop';
import {React, act, render} from '../../support';
import {IListData, makeStore, measure} from './support';

const ROWS = 200;
const titlesOrNames = (data: IListData): string =>
    data.items.map(row => data.titles ? row.title : row.owner.name).join(',');

describe('stable hook recomputes and watch wakes reuse the filed read set', () => {
    test('watch: an unchanged read set prunes nothing and does not re-subscribe', () => {
        const store = makeStore(ROWS);
        const seen: string[] = [];
        const stop = store.watch(titlesOrNames, (next) => { seen.push(next); });

        // The first wake learns the raw recording.
        store.run(draft => { draft.items[1].title = 'warm'; });
        const subscribes = store.subscribed.length;

        for (let round = 0; round < 3; round++) {
            const work = measure(() => store.run(draft => { draft.items[5].title = 'x' + round; }));
            expect(work.prunes).toBe(0);
        }
        expect(store.subscribed.length).toBe(subscribes);
        expect(seen.length).toBe(4);
        expect(seen[3].split(',')[5]).toBe('x2');

        // Positive control: a branch switch completes and re-files the new set.
        const work = measure(() => store.run(draft => { draft.titles = false; }));
        expect(work.prunes).toBe(1);
        expect(store.subscribed.length).toBe(subscribes + 1);
        expect(store.subscribed[subscribes].has('items.7.owner.name')).toBe(true);
        expect(store.subscribed[subscribes].has('items.7.title')).toBe(false);
        store.run(draft => { draft.items[7].title = 'quiet'; });
        expect(seen.length).toBe(5);
        store.run(draft => { draft.items[7].owner.name = 'loud'; });
        expect(seen[5].split(',')[7]).toBe('loud');
        stop();
    });

    test('hook: an unchanged read set prunes nothing and does not re-subscribe', () => {
        const store = makeStore(ROWS);
        let renders = 0;
        const List = () => {
            renders++;
            return <p>{useCarburetorValue(store, titlesOrNames)}</p>;
        };
        const {container, unmount} = render(<List/>);
        act(() => store.run(draft => { draft.items[1].title = 'warm'; }));
        const subscribes = store.subscribed.length;

        for (let round = 0; round < 3; round++) {
            const work = measure(() => act(() => store.run(draft => { draft.items[5].title = 'x' + round; })));
            expect(work.prunes).toBe(0);
        }
        expect(store.subscribed.length).toBe(subscribes);
        expect(container.textContent!.split(',')[5]).toBe('x2');
        const settled = renders;

        // Positive control: a branch switch re-files exactly once.
        const work = measure(() => act(() => store.run(draft => { draft.titles = false; })));
        expect(work.prunes).toBeGreaterThan(0);
        expect(store.subscribed.length).toBe(subscribes + 1);
        const filed = store.subscribed[subscribes];
        expect(filed.has('items.7.owner.name')).toBe(true);
        expect(filed.has('items.7.title')).toBe(false);
        act(() => store.run(draft => { draft.items[7].title = 'quiet'; }));
        expect(renders).toBe(settled + 1);
        act(() => store.run(draft => { draft.items[7].owner.name = 'loud'; }));
        expect(container.textContent!.split(',')[7]).toBe('loud');
        unmount();
    });
});
