import {act, render, fireEvent} from '@testing-library/react';
import {test, expect} from '@rstest/core';
import {
    Carburetor,
    CarburetorScope,
    CarburetorProvider,
    ScopedAntiHookComponent,
    carburetorToken,
    CarburetorHistory,
    ComponentUpdateThrottle,
    bind,
    persist,
    waitForUpdate,
} from 'react-carburetor';
const selectCount = (data: {count: number}) => data.count;

class CounterStore extends Carburetor<{count: number}> {
    increment() { this.draft.count += 1; this.emitUpdate(); }
}
const counterToken = carburetorToken(() => new CounterStore({count: 0}, new ComponentUpdateThrottle(1)), 'readme-test-counter');
class CounterView extends ScopedAntiHookComponent {
    @bind
    private increment(): void {
        this.resolve(counterToken).increment();
    }

    render() {
        const store = this.resolve(counterToken);
        const {count} = this.useCarburetor(store);
        return <button onClick={this.increment}>{count}</button>;
    }
}
test('publishes a counter update', async () => {
    const scope = new CarburetorScope();
    const store = scope.get(counterToken);
    const saved = new Map<string, string>();
    const stopPersist = persist(store, {key: 'counter', storage: {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => { saved.set(key, value); },
        removeItem: key => { saved.delete(key); },
    }});
    const history = new CarburetorHistory(store);
    const observed: number[] = [];
    const stopWatch = store.watch(selectCount, next => { observed.push(next); });
    const mounted = render(<CarburetorProvider scope={scope}><CounterView/></CarburetorProvider>);
    try {
        const delivered = waitForUpdate(store);
        await act(async () => {
            fireEvent.click(mounted.getByRole('button'));
            await delivered;
        });
        expect(mounted.getByRole('button').textContent).toBe('1');
        expect(observed).toEqual([1]);
    } finally {
        mounted.unmount();
        stopWatch();
        stopPersist();
        history.disconnect();
    }
});