import {rstest, expect} from '@rstest/core';
import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {carburetorToken} from '@/Carburetor/Component/Scope/carburetorToken';
import {createTestClock, createTestScope} from '@/Testing';

class TimerStore extends Carburetor<{count: number}> {
    public constructorCancel: () => void = (): void => {};
    public constructor(dataOrTask: {count: number} | (() => void) = {count: 0}) {
        const data = typeof dataOrTask === 'function' ? {count: 0} : dataOrTask;
        super(data);
        if (typeof dataOrTask === 'function') this.constructorCancel = this.after(20, dataOrTask);
    }
    public delay(ms: number, task: () => void): () => void { return this.after(ms, task); }
}
const tokens = new Map<string, ReturnType<typeof carburetorToken<TimerStore>>>();
const token = (id: string): ReturnType<typeof carburetorToken<TimerStore>> => {
    const known = tokens.get(id);
    if (known) return known;
    const created = carburetorToken(() => new TimerStore({count: 0}), id);
    tokens.set(id, created);
    return created;
};

describe('createTestClock', () => {
    test('advances exact deadlines once; nested due timers run in deadline/order', () => {
        const clock = createTestClock();
        const seen: string[] = [];
        clock.setTimeout(() => {
            seen.push('first');
            clock.setTimeout(() => seen.push('nested'), 5);
        }, 5);
        clock.setTimeout(() => seen.push('second'), 5);
        clock.advance(4);
        expect(seen).toEqual([]);
        clock.advance(6);
        clock.advance(10);
        expect(seen).toEqual(['first', 'second', 'nested']);
        expect(clock.now()).toBe(20);
        expect(clock.pending).toBe(0);
    });

    test('cancellation, runAll, and recurrence guard', () => {
        const clock = createTestClock();
        const id = clock.setTimeout(() => { throw new Error('cancelled'); }, 1);
        clock.clearTimeout(id);
        clock.setTimeout(() => clock.setTimeout(() => {}, 0), 0);
        clock.runAll();
        expect(clock.pending).toBe(0);
        const recur = (): void => { clock.setTimeout(recur, 0); };
        clock.setTimeout(recur, 0);
        expect(() => clock.runAll()).toThrow(/possible recurring timer loop/);
    });

    test('scope and child stores run only when due, once, and disposal cancels timers', () => {
        const clock = createTestClock();
        const scope = createTestScope(undefined, {clock});
        const root = scope.get(token('clock/root'));
        const child = scope.child([token('clock/child')]);
        const nested = child.get(token('clock/child'));
        const seen: string[] = [];
        root.delay(5, () => {
            seen.push('root');
            nested.delay(2, () => seen.push('nested'));
        });
        clock.advance(4);
        expect(seen).toEqual([]);
        clock.advance(1);
        expect(seen).toEqual(['root']);
        clock.advance(2);
        clock.advance(10);
        expect(seen).toEqual(['root', 'nested']);
        root.delay(50, () => seen.push('disposed'));
        expect(clock.pending).toBe(1);
        root.dispose();
        expect(clock.pending).toBe(0);
        expect(() => root.delay(1, () => {})).toThrow(/store has been disposed/);
        scope.dispose();
    });

    test('cancellation clears a clock timer; no-clock scopes and outside stores use globals', async () => {
        rstest.useFakeTimers();
        try {
            const clock = createTestClock();
            const calls: string[] = [];
            const scoped = createTestScope(undefined, {clock});
            const scopedStore = scoped.get(token('clock/cancel'));
            scopedStore.delay(5, () => { calls.push('scoped clock'); })();
            expect(clock.pending).toBe(0);
            const noClock = createTestScope();
            const ordinaryStore = noClock.get(token('clock/global-scope'));
            ordinaryStore.delay(5, () => { calls.push('no clock scope'); });
            const outside = new TimerStore({count: 0});
            outside.delay(5, () => { calls.push('outside'); });
            await rstest.advanceTimersByTimeAsync(5);
            expect(calls).toEqual(['no clock scope', 'outside']);
            expect(clock.pending).toBe(0);
            scoped.dispose();
            noClock.dispose();
            outside.dispose();
        } finally {
            rstest.useRealTimers();
        }
    });

    test('global constructor timers remain cancellable after lazy clock attachment', async () => {
        rstest.useFakeTimers();
        try {
            const clock = createTestClock();
            let called = false;
            const store = new TimerStore(() => { called = true; });
            const constructorCancel = store.constructorCancel;
            const scope = createTestScope([[token('clock/mixed'), store]], {clock});
            scope.get(token('clock/mixed')).delay(50, () => { called = true; });
            scope.dispose();
            await rstest.advanceTimersByTimeAsync(20);
            expect(called).toBe(false);
            expect(clock.pending).toBe(0);
            constructorCancel();
        } finally {
            rstest.useRealTimers();
        }
    });

    test('constructor-time timers are re-homed onto the clock with delay preserved', async () => {
        rstest.useFakeTimers();
        try {
            const clock = createTestClock();
            let called = false;
            const store = new TimerStore(() => { called = true; });
            const scope = createTestScope([[token('clock/rehome'), store]], {clock});
            expect(clock.pending).toBe(1);
            clock.advance(19);
            expect(called).toBe(false);
            await rstest.advanceTimersByTimeAsync(20);
            expect(called).toBe(false);
            clock.advance(1);
            expect(called).toBe(true);
            expect(clock.pending).toBe(0);
            scope.dispose();
        } finally {
            rstest.useRealTimers();
        }
    });

    test('the constructor-time disposer still cancels after re-homing', () => {
        const clock = createTestClock();
        let called = false;
        const store = new TimerStore(() => { called = true; });
        const cancel = store.constructorCancel;
        const scope = createTestScope([[token('clock/rehome-cancel'), store]], {clock});
        expect(clock.pending).toBe(1);
        cancel();
        clock.advance(100);
        expect(called).toBe(false);
        expect(clock.pending).toBe(0);
        scope.dispose();
    });

    test('scope disposal clears re-homed constructor timers', () => {
        const clock = createTestClock();
        let called = false;
        const store = new TimerStore(() => { called = true; });
        const scope = createTestScope([[token('clock/rehome-dispose'), store]], {clock});
        expect(clock.pending).toBe(1);
        scope.dispose();
        expect(clock.pending).toBe(0);
        clock.advance(100);
        expect(called).toBe(false);
    });

    test('a fired constructor timer is not re-run when a new clock attaches', () => {
        const clock = createTestClock();
        const clock2 = createTestClock();
        let calls = 0;
        const store = new TimerStore(() => { calls++; });
        const scope = createTestScope([[token('clock/rehome-fired'), store]], {clock});
        clock.advance(20);
        expect(calls).toBe(1);
        clock2.attach(store);
        expect(clock2.pending).toBe(0);
        clock2.advance(100);
        expect(calls).toBe(1);
        scope.dispose();
    });

    test('clock.attach() re-homes an unscoped store timer and cancels the real one', async () => {
        rstest.useFakeTimers();
        try {
            const clock = createTestClock();
            let called = false;
            const store = new TimerStore(() => { called = true; });
            store.constructorCancel();
            store.delay(20, () => { called = true; });
            clock.attach(store);
            expect(clock.pending).toBe(1);
            clock.advance(19);
            expect(called).toBe(false);
            clock.advance(1);
            expect(called).toBe(true);
            expect(clock.pending).toBe(0);
            store.dispose();
        } finally {
            rstest.useRealTimers();
        }
    });

    test('clock.attach() rejects non-store arguments', () => {
        const clock = createTestClock();
        expect(() => clock.attach('nope' as never)).toThrow(TypeError);
        expect(() => clock.attach('nope' as never)).toThrow(/expected a Carburetor store/);
        expect(() => clock.attach({})).toThrow(TypeError);
    });

    test('attaching a different clock moves pending timers to the new clock', () => {
        const clock = createTestClock();
        const clock2 = createTestClock();
        let calls = 0;
        const store = new TimerStore({count: 0});
        const scope = createTestScope([[token('clock/rehome-move'), store]], {clock});
        store.delay(50, () => { calls++; });
        clock2.attach(store);
        expect(clock.pending).toBe(0);
        expect(clock2.pending).toBe(1);
        clock2.advance(50);
        expect(calls).toBe(1);
        scope.dispose();
    });

    test('stores never attached keep real timers', async () => {
        rstest.useFakeTimers();
        try {
            const clock = createTestClock();
            let called = false;
            const store = new TimerStore({count: 0});
            store.delay(5, () => { called = true; });
            await rstest.advanceTimersByTimeAsync(5);
            expect(called).toBe(true);
            expect(clock.pending).toBe(0);
            store.dispose();
        } finally {
            rstest.useRealTimers();
        }
    });

    test('old override-only signature still works', () => {
        const override = new TimerStore({count: 2});
        const scope = createTestScope([[token('clock/override'), override]]);
        expect(scope.get(token('clock/override'))).toBe(override);
        scope.dispose();
    });

    test('invalid and overflowing delays are rejected', () => {
        const clock = createTestClock();
        expect(() => clock.advance(Number.NaN)).toThrow(/finite/);
        expect(() => clock.setTimeout(() => {}, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    });
});
