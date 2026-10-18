import {ComponentUpdateThrottle} from "@/Carburetor";

describe('ComponentUpdateThrottle window semantics', () => {
    test('an armed window does not slide while a stream keeps scheduling', async () => {
        rstest.useFakeTimers();

        try {
            const flushed: number[] = [];
            let tick = 0;
            let scheduledAt = 0;
            const throttle = new ComponentUpdateThrottle(40);

            // The stream never pauses: it pushes a value every 10 ms, each captured at
            // its own tick so a flush delivers the last value of its window.
            const stream = setInterval(() => {
                const at = tick++;
                scheduledAt = at;
                throttle.schedule('a', () => {
                    flushed.push(scheduledAt);
                });
            }, 10);

            // Silence just before the first window ends: no flush has fired yet.
            await rstest.advanceTimersByTimeAsync(39);
            expect(flushed).toEqual([]);

            // The flush timer armed at t=10 expires at t=50 and runs before the interval
            // tick inserted at t=40, so each window delivers its step-3/7/11/15/19 value:
            // re-arm 50->90->130->170->210, all inside this loop ending at t=239.
            await rstest.advanceTimersByTimeAsync(20 * 10);
            clearInterval(stream);

            expect(flushed).toEqual([3, 7, 11, 15, 19]);
        } finally {
            rstest.useRealTimers();
        }
    });

    test('nothing flushes before the window ends', async () => {
        rstest.useFakeTimers();

        try {
            const flushed: string[] = [];
            const throttle = new ComponentUpdateThrottle(40);

            throttle.schedule('a', () => {
                flushed.push('value');
            });

            await rstest.advanceTimersByTimeAsync(39);
            expect(flushed).toEqual([]);

            await rstest.advanceTimersByTimeAsync(1);
            expect(flushed).toEqual(['value']);
        } finally {
            rstest.useRealTimers();
        }
    });
});
