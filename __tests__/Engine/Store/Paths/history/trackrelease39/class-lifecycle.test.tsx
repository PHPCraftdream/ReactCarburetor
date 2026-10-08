import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {Store, makeStore, pathsSince, spyPaths, thousandWrites} from './support';

const tracked = (store: Store): boolean => {
    const baseline = store.getVersion();
    act(() => { store.change(d => { d.rows[0].a = baseline + 1000; }); });
    return pathsSince(store, baseline) !== undefined;
};

class Row extends AntiHookComponent<{store: Store}> {
    private readonly rows = this.connectSelection(() => this.props.store, d => d.rows);

    render() {
        return <p>{this.rows()[0].a}</p>;
    }
}

class Scalar extends AntiHookComponent<{store: Store}> {
    private readonly tick = this.connectSelection(() => this.props.store, d => d.tick);

    render() {
        return <p>{this.tick()}</p>;
    }
}

describe('connectSelection owns tracking while mounted (R39-04 release)', () => {
    test('mount enables tracking, unmount releases it', () => {
        const store = makeStore();
        const view = render(<Row store={store} />);
        expect(tracked(store)).toBe(true);
        view.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('1000 writes after unmount stay inside the no-consumer budget', () => {
        const store = makeStore();
        render(<Row store={store} />).unmount();
        const counts = thousandWrites(store, true);
        expect(counts.maps).toBeLessThanOrEqual(3);
        expect(counts.sets).toBeLessThanOrEqual(2000);
    });

    test('many renders hold one owner: a single unmount releases it', () => {
        const store = makeStore();
        const view = render(<Row store={store} />);
        for (let n = 1; n <= 5; n++) act(() => { store.change(d => { d.rows[0].a = n; }); });
        view.rerender(<Row store={store} />);
        view.rerender(<Row store={store} />);
        expect(view.container.textContent).toBe('5');
        view.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('StrictMode neither loses nor accumulates the owner', () => {
        const store = makeStore();
        const view = render(<React.StrictMode><Row store={store} /></React.StrictMode>);
        expect(tracked(store)).toBe(true);
        view.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('a source swap moves the owner to the new store', () => {
        const a = makeStore();
        const b = makeStore();
        const view = render(<Row store={a} />);
        expect(tracked(a)).toBe(true);
        view.rerender(<Row store={b} />);
        expect(tracked(a)).toBe(false);
        expect(tracked(b)).toBe(true);
        view.unmount();
        expect(tracked(b)).toBe(false);
    });

    test('a mounted selection still patches from the log; two instances release independently', () => {
        const store = makeStore();
        const answers = spyPaths(store);
        const first = render(<Row store={store} />);
        const second = render(<Row store={store} />);
        act(() => { store.change(d => { d.rows[0].a = 3; }); });
        expect(first.container.textContent).toBe('3');
        expect(answers.some(answer => answer !== undefined)).toBe(true);
        first.unmount();
        expect(tracked(store)).toBe(true);
        second.unmount();
        expect(tracked(store)).toBe(false);
    });

    test('a primitive selection never owns tracking', () => {
        const store = makeStore();
        const view = render(<Scalar store={store} />);
        expect(tracked(store)).toBe(false);
        view.unmount();
    });
});
