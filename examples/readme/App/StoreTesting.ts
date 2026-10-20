import {ComponentUpdateThrottle, waitForUpdate} from 'react-carburetor';
import {test, expect, rstest} from '@rstest/core';
import {RoundStore} from './RoundStore';

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
};
// #endregion test-body

