# Testing examples

Use `createTestClock()` for timer-driven behavior of scope-owned stores, or runner fake clocks otherwise. `createTestScope(overrides, {clock})` keeps the overrides argument and accepts an optional second
options argument. `clock.now()` returns simulated time, `clock.advance(ms)` runs due timers in the window,
`clock.pending` reports queued timers, and `clock.runAll()` drains them, with a 10,000-callback guard for
recurring timers. Constructor-time timers of override stores and any store passed to `clock.attach(store)`
run on the clock, with the remaining delay preserved; only stores never attached keep global timers.

<!-- example:file examples/readme/App/StoreTesting.ts#clock-test -->
```ts
class TimerStore extends Carburetor<{count: number}> {
    public delay(ms: number, task: () => void): void { this.after(ms, task); }
}
const timerToken = carburetorToken(() => new TimerStore({count: 0}), 'readme/store-testing-timer');

export const clockTest = (): void => {
    const clock = createTestClock();
    const scope = createTestScope(undefined, {clock});
    try {
        const fired: string[] = [];
        scope.get(timerToken).delay(25, () => { fired.push('done'); });
        clock.advance(24);
        expect(fired).toEqual([]);
        clock.advance(1);
        expect(fired).toEqual(['done']);
    } finally {
        scope.dispose();
    }
};
```

<!-- example:file examples/readme/App/StoreTesting.ts#attach-test -->
```ts
export const attachTest = (): void => {
    const store = new TimerStore({count: 0});
    const fired: string[] = [];
    try {
        store.delay(30, () => { fired.push('attached'); });
        const clock = createTestClock();
        clock.attach(store);
        clock.advance(29);
        expect(fired).toEqual([]);
        clock.advance(1);
        expect(fired).toEqual(['attached']);
    } finally {
        store.dispose();
    }
};
```

For non-clock work, `flush` and `createTestScope` come from `react-carburetor/testing`. The
[store testing recipe](../../README.md#testing-your-code) combines the helpers with a meaningful watch
flush and a fake-clock test for throttled delivery and `after()` cleanup.

<!-- example:file examples/readme/App/StoreTesting.ts#scope-test -->
```ts
export const scopeTest = (): void => {
    const scope = createTestScope([[
        scopeToken,
        new ScopeStore({count: 7})
    ]]);
    try {
        const store = scope.get(scopeToken);
        const observed: number[] = [];
        const stop = store.watch(selectCount, next => { observed.push(next); });
        try {
            store.increment();
            flush(store);
            expect(observed).toEqual([8]);
        } finally {
            stop();
        }
    } finally {
        scope.dispose();
    }
};
```
