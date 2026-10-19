import {UpdateWave} from "@/Carburetor/Store/Scheduling/UpdateWave";
import {UpdateBatch} from "@/Carburetor/Store/Transaction/UpdateBatch";
import {CARBURETOR_NOTIFY_WRITES, IInternalSubscriptionProtocol} from
    "@/Carburetor/Store/Utils/Models";
import {TPathSet} from "@/Carburetor/Models/Paths";
import {diagnostics} from "@/Carburetor";

class ProbeBatch extends UpdateBatch {
    public get pendingMap(): Map<IInternalSubscriptionProtocol, TPathSet> {
        return this.pending;
    }
}

const batchTarget = (name: string, run: () => void): IInternalSubscriptionProtocol => ({
    [CARBURETOR_NOTIFY_WRITES]: () => run(),
    subscribe: () => name,
    unsubscribe: () => {},
    getVersion: () => 0,
} as unknown as IInternalSubscriptionProtocol);

/**
 * R16-09: `end()`'s failures array is allocated only once something actually throws, not on
 * every drain. These tests pin the observable side of that — isolation and reporting still
 * work exactly as before — since the allocation itself leaves nothing to assert on from
 * outside (a deterministic allocation probe lives in the byte-measurement script, not here).
 */
describe('UpdateWave', () => {
    test('batch drain isolates failures and delivers re-entrant rounds in order', () => {
        const batch = new ProbeBatch();
        const originalError = console.error;
        const reported: string[] = [];
        const calls: string[] = [];
        let enqueueReentrant = true;
        const later = batchTarget('later', () => calls.push('later'));
        const first = batchTarget('first', () => {
            calls.push('first');
            if (!enqueueReentrant) return;
            enqueueReentrant = false;
            batch.begin();
            batch.add(first, new Set(['same-target']));
            batch.add(later, new Set(['other-target']));
            batch.end();
        });
        const failure = batchTarget('failure', () => {
            calls.push('failure');
            throw new Error('isolated');
        });
        batch.begin();
        batch.add(first, new Set(['first-write']));
        batch.add(failure, new Set(['failure-write']));
        console.error = (message: string) => reported.push(message);
        try {
            batch.end();
        } finally {
            console.error = originalError;
        }
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain('isolated');
        expect(calls).toEqual(['first', 'first', 'later', 'failure']);
        expect(batch.pendingMap.size).toEqual(0);
    });

    test('draining pending settlements avoids Array.from snapshots and preserves round order', () => {
        const wave = new UpdateWave();
        const originalFrom = Array.from;
        let snapshots = 0;
        let controlCount = 0;
        const settled: string[] = [];
        wave.begin();
        wave.defer('first', () => {
            settled.push('first');
            wave.defer('later', () => settled.push('replacement'));
        });
        wave.defer('later', () => settled.push('old'));
        Array.from = function(...args: Parameters<typeof Array.from>) {
            snapshots++;
            return originalFrom.apply(Array, args as never);
        } as typeof Array.from;
        try {
            Array.from([]);
            controlCount = snapshots;
            snapshots = 0;
            wave.end();
        } finally {
            Array.from = originalFrom;
        }
        expect(controlCount).toEqual(1);
        expect(snapshots).toEqual(0);
        expect(settled).toEqual(['first', 'old', 'replacement']);
    });

    test('a drain with no failures reports nothing', () => {
        const wave = new UpdateWave();
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            wave.begin();
            wave.defer('a', () => {});
            wave.end();
        } finally {
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('one throwing settlement does not stop the others, and is reported once the drain finishes', () => {
        const wave = new UpdateWave();
        const original = console.error;
        const reported: string[] = [];
        const settled: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            wave.begin();
            wave.defer('a', () => settled.push('a'));
            wave.defer('b', () => {
                throw new Error('b failed');
            });
            wave.defer('c', () => settled.push('c'));
            wave.end();
        } finally {
            console.error = original;
        }

        expect(settled).toEqual(['a', 'c']);
        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('b failed');
    });

    test('several failures across the same drain are all reported, in order', () => {
        const wave = new UpdateWave();
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            wave.begin();
            wave.defer('a', () => {
                throw new Error('first');
            });
            wave.defer('b', () => {
                throw new Error('second');
            });
            wave.end();
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(2);
        expect(reported[0]).toContain('first');
        expect(reported[1]).toContain('second');
    });

    test('a re-defer during the drain is settled before the wave finishes, failures included', () => {
        const wave = new UpdateWave();
        const original = console.error;
        const reported: string[] = [];
        const settled: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            wave.begin();
            wave.defer('a', () => {
                settled.push('a');
                // A settlement deferring more work mid-drain: end() keeps draining until
                // `pending` empties, not just for one pass.
                wave.defer('b', () => {
                    throw new Error('b failed on re-defer');
                });
            });
            wave.end();
        } finally {
            console.error = original;
        }

        expect(settled).toEqual(['a']);
        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('b failed on re-defer');
    });

    test('diagnostics disabled stays quiet even with a failure', () => {
        const wave = new UpdateWave();
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);
        diagnostics.setEnabled(false);

        try {
            wave.begin();
            wave.defer('a', () => {
                throw new Error('quiet failure');
            });
            wave.end();
        } finally {
            diagnostics.setEnabled(true);
            console.error = original;
        }

        expect(reported).toEqual([]);
    });
});
