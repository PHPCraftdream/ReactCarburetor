import {diagnostics} from '@/Carburetor';
import {UpdateWave} from '@/Carburetor/Store/Scheduling/UpdateWave';
import {UpdateBatch} from '@/Carburetor/Store/Transaction/UpdateBatch';
import {CARBURETOR_NOTIFY_WRITES} from '@/Carburetor/Store/Utils/Models';

/** Runs `body` with the development report silenced and a recording failure handler installed. */
const record = (body: () => void): Array<[unknown, string]> => {
    const handled: Array<[unknown, string]> = [];

    diagnostics.setFailureHandler((error, source) => { handled.push([error, source]); });
    diagnostics.setEnabled(false);

    try {
        body();
    } finally {
        diagnostics.setEnabled(true);
        diagnostics.setFailureHandler(undefined);
    }

    return handled;
};

describe('delivery round limits', () => {
    test('a transaction whose delivery keeps writing stops at the limit instead of hanging', () => {
        const batch = new UpdateBatch();
        let rounds = 0;
        const target = {
            [CARBURETOR_NOTIFY_WRITES]: (): void => {
                rounds++;
                batch.add(target as never, new Set(['a']));
            },
        };

        const handled = record(() => {
            batch.begin();
            batch.add(target as never, new Set(['a']));
            batch.end();
        });

        expect(rounds).toBe(1000);
        expect(batch.isActive()).toBe(false);
        expect(handled).toHaveLength(1);
        expect(handled[0][1]).toBe('transaction');
        expect((handled[0][0] as Error).message).toMatch(/exceeded 1000 delivery rounds/);
    });

    test('after an overflow the batch delivers a later transaction normally', () => {
        const batch = new UpdateBatch();
        const loop = {[CARBURETOR_NOTIFY_WRITES]: (): void => { batch.add(loop as never, new Set(['a'])); }};
        let delivered = 0;
        const calm = {[CARBURETOR_NOTIFY_WRITES]: (): void => { delivered++; }};

        record(() => {
            batch.begin();
            batch.add(loop as never, new Set(['a']));
            batch.end();
        });
        batch.begin();
        batch.add(calm as never, new Set(['a']));
        batch.end();

        expect(delivered).toBe(1);
    });

    test('a wave whose settlements keep deferring each other stops at the limit', () => {
        const wave = new UpdateWave();
        let settled = 0;
        const again = (): void => {
            settled++;
            wave.defer('loop', again);
        };

        const handled = record(() => {
            wave.begin();
            wave.defer('loop', again);
            wave.end();
        });

        expect(settled).toBe(1000);
        expect(wave.isActive()).toBe(false);
        expect(handled).toHaveLength(1);
        expect(handled[0][1]).toBe('settlement');
        expect((handled[0][0] as Error).message).toMatch(/exceeded 1000 drain rounds/);
    });

    test('a long but finite cascade is not cut off', () => {
        const wave = new UpdateWave();
        let settled = 0;
        const again = (): void => {
            if (++settled < 200) wave.defer('chain', again);
        };

        const handled = record(() => {
            wave.begin();
            wave.defer('chain', again);
            wave.end();
        });

        expect(settled).toBe(200);
        expect(handled).toEqual([]);
    });
});
