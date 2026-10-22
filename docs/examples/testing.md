# Testing examples

`createTestScope(overrides, {clock})` preserves the overrides argument and accepts an optional second
options argument.
`clock.now()` returns simulated time. `clock.advance(ms)` runs due timers in the window.
`clock.pending` reports queued timers; `clock.runAll()` drains them, with a 10,000-callback guard
for recurring timers. Timers scheduled before scope handout and timers outside a scope use globals.

```ts
import {Carburetor, carburetorToken} from 'react-carburetor';
import {createTestClock, createTestScope} from 'react-carburetor/testing';

class TimerStore extends Carburetor<{count: number}> {
    public delay(ms: number, task: () => void): void { this.after(ms, task); }
}
const timerToken = carburetorToken(() => new TimerStore({count: 0}), 'testing/timer');
const clock = createTestClock();
const scope = createTestScope(undefined, {clock});
const store = scope.get(timerToken);
store.delay(25, () => console.log('done'));
clock.advance(25);
clock.runAll();
scope.dispose();
```

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
