import {Carburetor, action, bind, transaction} from "@/Carburetor";

// Public export/type contract: @action preserves the decorated method signature.
function actionTypeContract(): void {
    class Store extends Carburetor<{value: number}> {
        constructor() { super({value: 0}); }
        @action increment(amount: number): number { this.draft.value += amount; return this.draft.value; }
    }
    const store = new Store();
    const result: number = store.increment(2);
    // @ts-expect-error decorated method retains required argument types
    store.increment('2');
    // @ts-expect-error action method return type remains unchanged
    const invalid: string = store.increment(2);
    void invalid;
    void result;
}
void actionTypeContract;

describe('@action', () => {
    test('publishes and preserves return', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @bind @action add(value: number): number { this.draft.value += value; return this.draft.value; }
        }
        const store = new Store(); let calls = 0; store.subscribe(() => calls++);
        expect(store.add(5)).toBe(5); expect(calls).toBe(1);
    });
    test('standalone multiple writes emit one update', () => {
        class Store extends Carburetor<{value: number}> {
            updates = 0;
            constructor() { super({value: 0}); }
            protected override emitUpdate(...args: Parameters<Carburetor<{value: number}>['emitUpdate']>) {
                this.updates++;
                super.emitUpdate(...args);
            }
            @action run() { this.draft.value++; this.draft.value++; }
        }
        const store = new Store(); let deliveries = 0; store.subscribe(() => deliveries++);
        store.run();
        expect(store.getData().value).toBe(2);
        expect(store.updates).toBe(1);
        expect(deliveries).toBe(1);
    });
    test('standalone nested action emits one update', () => {
        class Store extends Carburetor<{value: number}> {
            updates = 0;
            constructor() { super({value: 0}); }
            protected override emitUpdate(...args: Parameters<Carburetor<{value: number}>['emitUpdate']>) {
                this.updates++;
                super.emitUpdate(...args);
            }
            @action inner() { this.draft.value++; }
            @action outer() { this.inner(); this.inner(); }
        }
        const store = new Store(); let deliveries = 0; store.subscribe(() => deliveries++);
        store.outer();
        expect(store.getData().value).toBe(2);
        expect(store.updates).toBe(1);
        expect(deliveries).toBe(1);
    });
    test('nested action within transaction publishes once', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action inner() { this.draft.value++; }
            @action outer() { this.inner(); this.inner(); }
        }
        const store = new Store(); let calls = 0; store.subscribe(() => calls++);
        const version = store.getVersion(); transaction(() => store.outer());
        expect(store.getVersion()).toBe(version + 1); expect(calls).toBe(1);
    });
    test('disposed check precedes method side effects', () => {
        let calls = 0;
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run() { calls++; }
        }
        const store = new Store(); store.dispose();
        expect(() => store.run()).toThrow('Carburetor: store has been disposed'); expect(calls).toBe(0);
    });
    test('publishes writes when method throws', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run(): never { this.draft.value++; throw new Error('stop'); }
        }
        const store = new Store(); let calls = 0; store.subscribe(() => calls++);
        expect(() => store.run()).toThrow('stop'); expect(store.getData().value).toBe(1); expect(calls).toBe(1);
    });
    test('both binding orders retain detached receiver', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action @bind first() { this.draft.value++; }
            @bind @action second() { this.draft.value++; }
        }
        const store = new Store(); const first = store.first; const second = store.second;
        first(); second(); expect(store.getData().value).toBe(2);
    });
    test('warns for a Promise result', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run() { this.draft.value++; return Promise.resolve('done'); }
        }
        const store = new Store(); let deliveries = 0; store.subscribe(() => deliveries++);
        const promise = Promise.resolve('done');
        const originalResolve = Promise.resolve;
        const prior = console.error;
        const errors: unknown[][] = [];
        Promise.resolve = (() => promise) as typeof Promise.resolve;
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            const result = store.run();
            expect(result).toBe(promise);
            expect(store.getData().value).toBe(1);
            expect(deliveries).toBe(1);
            expect(errors.some(args => String(args[0]).toLowerCase().includes('promise'))).toBe(true);
        } finally {
            Promise.resolve = originalResolve;
            console.error = prior;
        }
    });

    test('warns for a thenable result', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run() { this.draft.value++; return {then: () => undefined}; }
        }
        const store = new Store(); let deliveries = 0; store.subscribe(() => deliveries++);
        const prior = console.error;
        const errors: unknown[][] = [];
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            store.run();
            expect(store.getData().value).toBe(1);
            expect(deliveries).toBe(1);
            expect(errors.some(args => String(args[0]).includes('@action'))).toBe(true);
        } finally { console.error = prior; }
    });
    test('inherited decorated actions publish against derived store', () => {
        class Parent extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action increment() { this.draft.value++; }
        }
        class Child extends Parent {}
        const store = new Child(); let calls = 0; store.subscribe(() => calls++);
        store.increment();
        expect(store.getData().value).toBe(1);
        expect(calls).toBe(1);
    });

    test('no-op action preserves version', () => {
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run() {}
        }
        const store = new Store(); const version = store.getVersion(); store.run();
        expect(store.getVersion()).toBe(version);
    });
});
