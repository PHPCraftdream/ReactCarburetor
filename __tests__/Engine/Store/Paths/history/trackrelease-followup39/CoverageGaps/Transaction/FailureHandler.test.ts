import {Carburetor, ComponentUpdateThrottle, diagnostics} from '@/Carburetor';
import {UpdateWave} from '@/Carburetor/Store/Scheduling/UpdateWave';
import {UpdateBatch} from '@/Carburetor/Store/Transaction/UpdateBatch';
import {CARBURETOR_NOTIFY_WRITES} from '@/Carburetor/Store/Utils/Models';

class Counter extends Carburetor<{n: number}> {
    public bump(): void { this.update(draft => { draft.n++; }); }
}

type THandler = (error: unknown, source: string) => void;

/** Runs `body` with the development report silenced and a failure handler installed. */
const withHandler = (body: () => void, handler?: THandler): Array<[unknown, string]> => {
    const handled: Array<[unknown, string]> = [];

    diagnostics.setFailureHandler(handler ?? ((error, source) => { handled.push([error, source]); }));
    diagnostics.setEnabled(false);

    try {
        body();
    } finally {
        diagnostics.setEnabled(true);
        diagnostics.setFailureHandler(undefined);
    }

    return handled;
};

describe('diagnostics failure handler', () => {
    test('a throwing subscriber reaches the handler as thrown, and the next subscriber still runs', () => {
        const boom = new Error('subscriber failed');
        const store = new Counter({n: 0});
        let healthy = 0;

        store.subscribe(() => { throw boom; });
        store.subscribe(() => { healthy++; });

        const handled = withHandler(() => store.bump());

        expect(handled).toEqual([[boom, 'delivery']]);
        expect(handled[0][0]).toBe(boom);
        expect(healthy).toBe(1);
        expect(store.getData().n).toBe(1);
    });

    test('a carburetor that fails to deliver inside a transaction is reported once, the others still notified', () => {
        const boom = new Error('delivery failed');
        const delivered: string[] = [];
        const broken = {[CARBURETOR_NOTIFY_WRITES]: (): void => { throw boom; }};
        const healthy = {[CARBURETOR_NOTIFY_WRITES]: (): void => { delivered.push('healthy'); }};
        const batch = new UpdateBatch();

        const handled = withHandler(() => {
            batch.begin();
            batch.add(broken as never, new Set(['a']));
            batch.add(healthy as never, new Set(['a']));
            batch.end();
        });

        expect(handled).toEqual([[boom, 'transaction']]);
        expect(delivered).toEqual(['healthy']);
    });

    test('a deferred settlement that throws is reported, and the settlements behind it still run', () => {
        const boom = new Error('settlement failed');
        const order: string[] = [];
        const wave = new UpdateWave();

        const handled = withHandler(() => {
            wave.begin();
            wave.defer('first', () => { throw boom; });
            wave.defer('second', () => { order.push('second'); });
            wave.end();
        });

        expect(handled).toEqual([[boom, 'settlement']]);
        expect(order).toEqual(['second']);
        expect(wave.isActive()).toBe(false);
    });

    test('a throttled updater that throws is reported, and the updaters behind it still run', () => {
        const boom = new Error('updater failed');
        const throttle = new ComponentUpdateThrottle(0);
        let ran = 0;

        throttle.schedule('first', () => { throw boom; });
        throttle.schedule('second', () => { ran++; });

        const handled = withHandler(() => { expect(throttle.flushPendingUpdates()).toBe(true); });

        expect(handled).toEqual([[boom, 'update']]);
        expect(ran).toBe(1);
    });

    test('a handler that throws cannot break the delivery it observes', () => {
        const store = new Counter({n: 0});
        let healthy = 0;

        store.subscribe(() => { throw new Error('subscriber failed'); });
        store.subscribe(() => { healthy++; });

        withHandler(() => store.bump(), () => { throw new Error('handler failed'); });

        expect(healthy).toBe(1);
    });

    test('without a handler nothing is reported, and a non-function is refused', () => {
        expect(() => diagnostics.reportFailure(new Error('nobody listens'), 'delivery')).not.toThrow();
        expect(() => diagnostics.setFailureHandler('handler' as never)).toThrow(TypeError);
    });

    test('setting a handler again replaces the first, and undefined removes it', () => {
        const first: unknown[] = [];
        const second: unknown[] = [];

        diagnostics.setFailureHandler(error => { first.push(error); });
        diagnostics.setFailureHandler(error => { second.push(error); });
        diagnostics.reportFailure('a', 'delivery');
        diagnostics.setFailureHandler(undefined);
        diagnostics.reportFailure('b', 'delivery');

        expect(first).toEqual([]);
        expect(second).toEqual(['a']);
    });
});
