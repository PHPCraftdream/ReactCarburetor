import {Carburetor, ComponentUpdateThrottle, waitForUpdate} from 'react-carburetor';
import {test, expect, rstest} from '@rstest/core';
import {RoundStore} from './RoundStore';

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

// #region test-body
export const registerStoreTest = (): void => {
    test('a throttled store can be tested without React', async () => {
        rstest.useFakeTimers();
        const store = new RoundStore(
            {round: {kind: 'quiz', wrong: [0], locked: false}},
            new ComponentUpdateThrottle(40)
        );
        const observed: number[] = [];
        const stopWatch = store.watch(
            (data) => data.round.wrong[0],
            (next) => { observed.push(next); }
        );

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

