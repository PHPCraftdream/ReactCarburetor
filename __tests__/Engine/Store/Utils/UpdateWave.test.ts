import {UpdateWave} from "@/Carburetor/Store/Scheduling/UpdateWave";
import {diagnostics} from "@/Carburetor";

/**
 * R16-09: `end()`'s failures array is allocated only once something actually throws, not on
 * every drain. These tests pin the observable side of that — isolation and reporting still
 * work exactly as before — since the allocation itself leaves nothing to assert on from
 * outside (a deterministic allocation probe lives in the byte-measurement script, not here).
 */
describe('UpdateWave', () => {
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
