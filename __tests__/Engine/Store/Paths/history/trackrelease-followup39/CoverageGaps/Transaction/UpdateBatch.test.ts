import {rstest} from '@rstest/core';
import {UpdateBatch} from "@/Carburetor/Store/Transaction/UpdateBatch";
import {CARBURETOR_NOTIFY_WRITES} from "@/Carburetor/Store/Utils/Models";

describe('UpdateBatch', () => {
    test('collects nested writes and drains deferred events FIFO after flush', () => {
        const batch = new UpdateBatch();
        const order: string[] = [];
        const target = {[CARBURETOR_NOTIFY_WRITES]: rstest.fn(() => order.push('writes'))};
        batch.begin();
        batch.begin();
        expect(batch.isActive()).toBe(true);
        batch.add(target as never, new Set(['x']));
        batch.add(target as never, new Set(['y']));
        batch.enqueueAfterFlush(() => order.push('event-1'));
        batch.enqueueAfterFlush(() => order.push('event-2'));
        batch.end();
        expect(order).toEqual([]);
        batch.end();
        expect(target[CARBURETOR_NOTIFY_WRITES]).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['writes', 'event-1', 'event-2']);
        expect(target[CARBURETOR_NOTIFY_WRITES].mock.calls[0][0]).toEqual(new Set(['x', 'y']));
    });
});
