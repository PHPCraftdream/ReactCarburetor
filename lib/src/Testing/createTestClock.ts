import {ITestClock as ITestClockApi} from './ITestClock';
import {Carburetor} from '../Carburetor/Store/Carburetor';
import {storeLifecycle} from '../Carburetor/Store/Diagnostics/Internal/StoreLifecycle';

/**
 * Create an isolated deterministic clock for scope-owned store timers.
 *
 * @returns Clock for use with createTestScope; scoped stores use it, and stores outside a scope can
 * be attached with clock.attach(store). Stores never attached keep using global timers.
 */
export const createTestClock = (): ITestClockApi => {
    let time = 0;
    let order = 0;
    const jobs = new Map<number, {at: number; order: number; task: () => void}>();
    const takeNext = (limit: number): boolean => {
        let selected: [number, {at: number; order: number; task: () => void}] | undefined;
        for (const entry of jobs) {
            if (entry[1].at > limit) continue;
            if (!selected || entry[1].at < selected[1].at
                || (entry[1].at === selected[1].at && entry[1].order < selected[1].order)) selected = entry;
        }
        if (!selected) return false;
        jobs.delete(selected[0]);
        time = selected[1].at;
        selected[1].task();
        return true;
    };
    const advance = (ms: number): void => {
        if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(time + ms)) {
            throw new RangeError('createTestClock.advance: ms must be finite, non-negative, and not overflow time');
        }
        const target = time + ms;
        while (takeNext(target)) {}
        time = target;
    };
    const clockApi: ITestClockApi = {
        advance,
        runAll: (): void => {
            let count = 0;
            while (jobs.size) {
                if (++count > 10000) {
                    throw new Error('createTestClock.runAll: exceeded 10000 timers; possible recurring timer loop');
                }
                takeNext(Infinity);
            }
        },
        now: (): number => time,
        setTimeout: (task, ms): number => {
            if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(time + ms)) {
                throw new RangeError('createTestClock.setTimeout: ms must be finite, non-negative, and not overflow time');
            }
            const id = ++order;
            jobs.set(id, {at: time + ms, order: id, task});
            return id;
        },
        clearTimeout: (id): void => { jobs.delete(id); },
        get pending(): number { return jobs.size; },
        attach: (store: object): void => {
            if (!(store instanceof Carburetor)) {
                throw new TypeError('createTestClock.attach: expected a Carburetor store');
            }
            storeLifecycle.useClock(store, clockApi);
        },
    };
    return clockApi;
};
