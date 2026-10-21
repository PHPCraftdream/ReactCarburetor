# Testing examples

Use runner fake clocks for timer-driven behavior. For non-clock work, `flush` and `createTestScope`
come from `react-carburetor/testing`; they do not replace or wrap runner clock APIs. The
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
        const stop = store.watch(data => data.count, next => { observed.push(next); });
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
