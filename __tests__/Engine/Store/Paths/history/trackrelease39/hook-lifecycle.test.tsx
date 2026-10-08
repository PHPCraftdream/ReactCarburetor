import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {useCarburetorValue} from '@/Interop';
import {Store, makeStore, pathsSince, spyPaths, thousandWrites} from './support';

const tracked = (store: Store): boolean => {
    const baseline = store.getVersion();
    act(() => { store.change(d => { d.rows[0].a = baseline + 1000; }); });
    return pathsSince(store, baseline) !== undefined;
};

const Rows = ({store}: {store: Store}): React.ReactElement => {
    const rows = useCarburetorValue(store, d => d.rows);
    return <p>{rows[0].a}</p>;
};

const Primitive = ({store}: {store: Store}): React.ReactElement => <p>{useCarburetorValue(store, d => d.tick)}</p>;

describe('useCarburetorValue owns tracking while mounted (R39-04 release)', () => {
    test('mount enables tracking, unmount releases it', () => {
        const store = makeStore();
        const view = render(<Rows store={store} />);
        expect(tracked(store)).toBe(true);
        view.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('1000 writes after unmount stay inside the no-consumer budget', () => {
        const store = makeStore();
        render(<Rows store={store} />).unmount();
        const counts = thousandWrites(store, true);
        expect(counts.maps).toBeLessThanOrEqual(3);
        expect(counts.sets).toBeLessThanOrEqual(2000);
    });

    test('StrictMode double mount neither loses nor accumulates the owner', () => {
        const store = makeStore();
        const view = render(<React.StrictMode><Rows store={store} /></React.StrictMode>);
        expect(tracked(store)).toBe(true);
        view.rerender(<React.StrictMode><Rows store={store} /></React.StrictMode>);
        expect(tracked(store)).toBe(true);
        view.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('a mounted write patches through the log; a remount after unmount converges', () => {
        const store = makeStore();
        const answers = spyPaths(store);
        const first = render(<Rows store={store} />);
        act(() => { store.change(d => { d.rows[0].a = 1; }); });
        act(() => { store.change(d => { d.rows[0].a = 2; }); });
        expect(first.container.textContent).toBe('2');
        expect(answers.length).toBeGreaterThan(0);
        expect(answers.every(answer => answer !== undefined)).toBe(true);
        first.unmount();

        act(() => { store.change(d => { d.rows[0].a = 3; }); });
        const second = render(<Rows store={store} />);
        act(() => { store.change(d => { d.rows[0].a = 4; }); });
        expect(second.container.textContent).toBe('4');
        second.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('a write between render and subscription costs one conservative answer, then patches resume', () => {
        const store = makeStore();
        const answers = spyPaths(store);
        const Writer = (): null => {
            React.useLayoutEffect(() => { store.change(d => { d.rows[0].a = 7; }); }, []);
            return null;
        };
        const view = render(<><Rows store={store} /><Writer /></>);
        expect(view.container.textContent).toBe('7');
        const conservative = answers.filter(answer => answer === undefined).length;
        expect(conservative).toBeLessThanOrEqual(1);
        const before = answers.length;
        act(() => { store.change(d => { d.rows[0].a = 8; }); });
        expect(view.container.textContent).toBe('8');
        expect(answers.length).toBeGreaterThan(before);
        expect(answers.slice(before).every(answer => answer !== undefined)).toBe(true);
        view.unmount();
    });

    test('two mounted hooks: unmounting one keeps tracking', () => {
        const store = makeStore();
        const first = render(<Rows store={store} />);
        const second = render(<Rows store={store} />);
        first.unmount();
        expect(tracked(store)).toBe(true);
        second.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('swapping the store moves the owner; a primitive selection never owns one', () => {
        const a = makeStore();
        const b = makeStore();
        const view = render(<Rows store={a} />);
        expect(tracked(a)).toBe(true);
        view.rerender(<Rows store={b} />);
        expect(tracked(a)).toBe(false);
        expect(tracked(b)).toBe(true);
        view.rerender(<Primitive store={a} />);
        expect(tracked(a)).toBe(false);
        expect(tracked(b)).toBe(false);
        view.unmount();
    });
});
