import {createRoot} from 'react-dom/client';
import {React, act, render, AntiHookComponent} from '../../support';
import {IListData, ListStore, makeStore} from './support';

type TMode = 'track' | 'connect' | 'selection';

/** Reads `count` rows (titles or names) and, while `showExtra` is set, the extra field too. */
const pick = (data: IListData, count: number): string => {
    const parts: string[] = [];
    for (let index = 0; index < count; index++) {
        const row = data.items[index];
        parts.push(data.titles ? row.title : row.owner.name);
    }
    if (data.showExtra) parts.push('e' + data.extra);
    return parts.join(',');
};

const makeView = (store: ListStore, mode: TMode, rows: {count: number}) => {
    const probe = {renders: 0, text: ''};

    class View extends AntiHookComponent {
        private readonly data = this.connect(() => store);
        private readonly picked = this.connectSelection(() => store, data => ({text: pick(data, rows.count)}));

        render() {
            probe.renders++;
            probe.text = mode === 'track' ? pick(this.useCarburetor(store), rows.count)
                : mode === 'connect' ? pick(this.data, rows.count) : this.picked().text;
            return <p>{probe.text}</p>;
        }
    }

    return {View, probe};
};

/** Two stable updates: the first learns the recording, the second reuses it. */
const warm = (store: ListStore): void => {
    act(() => store.run(draft => { draft.items[0].title += '.'; }));
    act(() => store.run(draft => { draft.items[0].title += '.'; }));
};

describe('read sets that move between renders re-file exactly as before', () => {
    for (const mode of ['track', 'connect', 'selection'] as const) {
        test(`${mode}: a gained read subscribes and a lost read unsubscribes`, () => {
            const store = makeStore(8);
            const rows = {count: 3};
            const {View, probe} = makeView(store, mode, rows);
            const {unmount} = render(<View/>);
            warm(store);

            // Gain: the extra field joins the read set.
            act(() => store.run(draft => { draft.showExtra = true; }));
            let renders = probe.renders;
            act(() => store.run(draft => { draft.extra = 3; }));
            expect(probe.renders).toBe(renders + 1);
            expect(probe.text.endsWith('e3')).toBe(true);

            // Loss: the field leaves the read set; a later write to it stays quiet.
            act(() => store.run(draft => { draft.showExtra = false; }));
            warm(store);
            renders = probe.renders;
            act(() => store.run(draft => { draft.extra = 6; }));
            expect(probe.renders).toBe(renders);

            // A lost row read with every other path unchanged.
            rows.count = 2;
            act(() => store.run(draft => { draft.items[1].title = 'shrink'; }));
            const shrunk = probe.renders;
            act(() => store.run(draft => { draft.items[2].title = 'gone'; }));
            expect(probe.renders).toBe(shrunk);
            act(() => store.run(draft => { draft.items[1].title = 'kept'; }));
            expect(probe.renders).toBe(shrunk + 1);
            expect(probe.text).toBe(`${store.getData().items[0].title},kept`);

            // A gained row read on an otherwise stable recording.
            warm(store);
            rows.count = 3;
            act(() => store.run(draft => { draft.items[1].title = 'grow'; }));
            const grown = probe.renders;
            act(() => store.run(draft => { draft.items[2].title = 'back'; }));
            expect(probe.renders).toBe(grown + 1);
            expect(probe.text.endsWith('grow,back')).toBe(true);
            unmount();
            expect(store.subscriberCount()).toBe(0);
        });

        test(`${mode}: StrictMode double renders keep the subscriptions exact`, () => {
            const store = makeStore(4);
            const {View, probe} = makeView(store, mode, {count: 3});
            const {unmount} = render(<React.StrictMode><View/></React.StrictMode>);
            warm(store);
            warm(store);

            act(() => store.run(draft => { draft.titles = false; }));
            const renders = probe.renders;
            act(() => store.run(draft => { draft.items[1].title = 'quiet'; }));
            expect(probe.renders).toBe(renders);
            act(() => store.run(draft => { draft.items[1].owner.name = 'loud'; }));
            expect(probe.renders).toBeGreaterThan(renders);
            expect(probe.text).toBe('n0,loud,n2');

            act(() => store.run(draft => { draft.titles = true; }));
            warm(store);
            act(() => store.run(draft => { draft.items[1].title = 'back'; }));
            expect(probe.text).toBe(`${store.getData().items[0].title},back,t2`);
            unmount();
            expect(store.subscriberCount()).toBe(0);
        });
    }
});

describe('abandoned attempts leave the committed read set alone', () => {
    test('a suspended render that read an extra path neither subscribes it nor breaks the reuse', async () => {
        const store = makeStore(4);
        let release: () => void = () => {};
        let pending: Promise<void> | undefined;
        const probe = {renders: 0};

        class View extends AntiHookComponent {
            render() {
                probe.renders++;
                const data = this.useCarburetor(store);
                const text = pick(data, 3);
                if (data.showExtra) {
                    pending ??= new Promise<void>(resolve => { release = resolve; });
                    throw pending;
                }
                return <p>{text}</p>;
            }
        }

        const {container, unmount} = render(<React.Suspense fallback={<i>wait</i>}><View/></React.Suspense>);
        warm(store);

        // The suspended attempts read `extra` and throw; nothing commits them.
        act(() => store.run(draft => { draft.showExtra = true; }));
        expect(container.textContent).toContain('wait');
        await act(async () => {
            store.run(draft => { draft.showExtra = false; });
            release();
            await pending;
        });
        expect(container.textContent).toBe(`${store.getData().items[0].title},t1,t2`);

        warm(store);
        const renders = probe.renders;
        act(() => store.run(draft => { draft.extra = 4; }));
        expect(probe.renders).toBe(renders);
        act(() => store.run(draft => { draft.items[2].title = 'live'; }));
        expect(probe.renders).toBe(renders + 1);
        expect(container.textContent!.endsWith('live')).toBe(true);
        unmount();
        expect(store.subscriberCount()).toBe(0);
    });

    test('a render thrown once and retried commits only the retry', () => {
        const store = makeStore(4);
        const probe = {renders: 0, thrown: 0};
        let throwOnce = false;

        class View extends AntiHookComponent {
            render() {
                probe.renders++;
                const data = this.useCarburetor(store);
                const text = pick(data, 2);
                if (throwOnce) {
                    throwOnce = false;
                    probe.thrown++;
                    void data.extra;
                    throw new Error('once');
                }
                return <p>{text}</p>;
            }
        }

        const container = document.createElement('div');
        const recovered: unknown[] = [];
        const root = createRoot(container, {onRecoverableError: error => { recovered.push(error); }});
        act(() => root.render(<View/>));
        warm(store);

        throwOnce = true;
        act(() => store.run(draft => { draft.items[1].title = 'retry'; }));
        expect(probe.thrown).toBe(1);
        expect(recovered.length).toBe(1);
        expect(container.textContent).toBe(`${store.getData().items[0].title},retry`);

        const renders = probe.renders;
        act(() => store.run(draft => { draft.extra = 9; }));
        expect(probe.renders).toBe(renders);
        warm(store);
        act(() => store.run(draft => { draft.items[1].title = 'live'; }));
        expect(container.textContent!.endsWith(',live')).toBe(true);
        act(() => root.unmount());
        expect(store.subscriberCount()).toBe(0);
    });
});
