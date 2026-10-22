import {createTestClock, createTestScope, flush} from 'react-carburetor/testing';
import {Carburetor, ComponentUpdateThrottle, waitForUpdate, carburetorToken} from 'react-carburetor';
import {test, expect, rstest} from '@rstest/core';
import {RoundStore} from './RoundStore';

class ScopeStore extends Carburetor<{count: number}> {
    public increment(): void { this.draft.count += 1; this.emitUpdate(); }
}
const scopeToken = carburetorToken(
    () => new ScopeStore({count: 0}, new ComponentUpdateThrottle(40)),
    'readme/store-testing-scope'
);

const selectFirstWrong = (data: {round: {wrong: readonly number[]}}): number => data.round.wrong[0];
const selectCount = (data: {count: number}): number => data.count;

// #region timer-store
const showHint = (draft: {hint: boolean}): void => {
    draft.hint = true;
};

/** Shows a hint after ten seconds of silence; the timer dies with the store. */
class HintStore extends Carburetor<{hint: boolean}> {
    /** Arms the idle hint. */
    public arm(): void {
        this.after(10_000, () => this.update(showHint));
    }
}
// #endregion timer-store

// #region scope-test
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
// #endregion scope-test

// #region test-body
export const registerStoreTest = (): void => {
    test('a throttled store can be tested without React', async () => {
        rstest.useFakeTimers();
        const store = new RoundStore(
            {round: {kind: 'quiz', wrong: [0], locked: false}},
            new ComponentUpdateThrottle(40)
        );
        const observed: number[] = [];
        const stopWatch = store.watch(selectFirstWrong, (next) => { observed.push(next); });

        try {
            const delivered = waitForUpdate(store);
            store.markWrong(0);
            expect(store.getData().round.wrong[0]).toBe(1);
            expect(observed).toEqual([]);
            await rstest.advanceTimersByTimeAsync(40);
            await delivered;
            expect(observed).toEqual([1]);
        } finally {
            stopWatch();
            rstest.useRealTimers();
        }
    });

    test('a timer started with after() never fires once the store is disposed', () => {
        rstest.useFakeTimers();
        try {
            const store = new HintStore({hint: false});
            store.arm();
            store.dispose();
            rstest.advanceTimersByTime(10_000);
            expect(store.getData().hint).toBe(false);
        } finally {
            rstest.useRealTimers();
        }
    });
};
// #endregion test-body

// #region clock-test
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
// #endregion clock-test
