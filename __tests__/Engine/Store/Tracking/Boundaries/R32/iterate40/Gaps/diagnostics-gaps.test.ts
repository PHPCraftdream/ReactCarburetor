import {Carburetor, diagnostics} from '@/Carburetor';
import {action} from '@/Carburetor/Store/Diagnostics/Internal/Action/action';
import {storeLifecycle} from '@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle';
import {reportDeliveryFailure} from '@/Carburetor/Store/Diagnostics/reportDeliveryFailure';
import {deliveryCallback} from '@/Carburetor/Store/Diagnostics/Internal/scheduleTrace';

describe('action', () => {
    test('swallows a hostile then getter and preserves the method result and write', () => {
        const then = ['th', 'en'].join('');
        const hostile = Object.defineProperty({}, then, {get() { throw Error('hostile'); }});
        class Store extends Carburetor<{value: number}> {
            constructor() { super({value: 0}); }
            @action run() {
                this.update(draft => { draft.value = 1; });
                return hostile;
            }
        }
        const errors: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const store = new Store();
            const result = store.run();
            expect(result).toBe(hostile);
            expect(store.getData().value).toBe(1);
            expect(errors).toEqual([]);
        } finally { console.error = original; }
    });
});

describe('Diagnostics', () => {
    test('threshold validation, enablement, labeling, and once-per-pair wide-read reports', () => {
        const component = {};
        const store = {};
        const errors: unknown[][] = [];
        const original = console.error;
        const originalEnabled = diagnostics.isEnabled();
        const originalThreshold = diagnostics.getWideReadThreshold();
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            expect(() => diagnostics.setWideReadThreshold(-1)).toThrow(RangeError);
            expect(() => diagnostics.setWideReadThreshold(Number.NaN)).toThrow(RangeError);
            diagnostics.setWideReadThreshold(1);
            diagnostics.registerComponent(component, 'View');
            diagnostics.reportWideRead(component, store, 'store-1', 1);
            expect(errors).toHaveLength(0);
            diagnostics.reportWideRead(component, store, 'store-1', 2);
            diagnostics.reportWideRead(component, store, 'store-1', 3);
            expect(errors).toHaveLength(1);
            expect(errors[0][0]).toContain('Wide read by View from store store-1: 2 paths');
            diagnostics.setEnabled(false);
            diagnostics.report('hidden');
            expect(errors).toHaveLength(1);
            diagnostics.setEnabled(true);
        } finally {
            diagnostics.setEnabled(originalEnabled);
            diagnostics.setWideReadThreshold(originalThreshold);
            console.error = original;
        }
    });

    test('trace registrations are independent and listener failures do not interrupt others', () => {
        const events: unknown[] = [];
        const listener = () => { throw Error('observer'); };
        const stopOne = diagnostics.traceUpdates(listener);
        const stopTwo = diagnostics.traceUpdates(event => events.push(event));
        try {
            diagnostics.traceUpdate('subscriber', 'store', new Set(['a']), 4);
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({subscriber: 'subscriber', store: 'store', paths: ['a'], version: 4});
            stopOne();
            stopOne();
            diagnostics.traceUpdate('subscriber', 'store', new Set(), 5);
            expect(events).toHaveLength(2);
        } finally { stopOne(); stopTwo(); }
    });
});

describe('StoreLifecycle', () => {
    test('aborts signal, runs all cleanup steps, preserves first failure, and rejects later work', () => {
        const owner = {};
        const signal = storeLifecycle.signal(owner);
        const steps: number[] = [];
        const failure = Error('first cleanup');
        expect(() => storeLifecycle.dispose(owner, [
            () => { steps.push(1); throw failure; },
            () => { steps.push(2); throw Error('later cleanup'); }
        ])).toThrow(failure);
        expect(signal.aborted).toBe(true);
        expect(steps).toEqual([1, 2]);
        expect(storeLifecycle.isDisposed(owner)).toBe(true);
        expect(() => storeLifecycle.after(owner, 0, () => undefined)).toThrow('store has been disposed');
        storeLifecycle.dispose(owner, [() => steps.push(3)]);
        expect(steps).toEqual([1, 2]);
    });
});

describe('reportDeliveryFailure', () => {
    test('reports Error messages and stringifies non-Errors', () => {
        const errors: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            reportDeliveryFailure(new Error('subscriber failed'));
            reportDeliveryFailure({toString: () => 'odd failure'});
            expect(errors.map(args => args[0])).toEqual([
                'Carburetor: a subscriber threw while a write was delivered: subscriber failed. ' +
                    'The write had already landed, so the remaining subscribers were notified anyway.',
                'Carburetor: a subscriber threw while a write was delivered: odd failure. ' +
                    'The write had already landed, so the remaining subscribers were notified anyway.'
            ]);
        } finally { console.error = original; }
    });
});

describe('deliveryCallback', () => {
    test('inactive delivery returns callback; active delivery traces matching writes then invokes', () => {
        let calls = 0;
        const callback = () => { calls++; };
        const record = {callback, reads: new Set(['a'])} as never;
        const writes = new Set(['a', 'unread']);
        const inactive = deliveryCallback(false, 'fallback', 'store', record, writes, 1, () => record);
        expect(inactive).toBe(callback);
        const seen: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => seen.push(event));
        try {
            deliveryCallback(true, 'fallback', 'store', record, writes, 2, () => record)();
            expect(calls).toBe(1);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toMatchObject({subscriber: 'fallback', paths: ['a'], version: 2});
        } finally { stop(); }
    });

    test('suppresses replaced records and does not trace across a listener epoch', () => {
        let calls = 0;
        const callback = () => { calls++; };
        const record = {callback, reads: new Set(['a'])} as never;
        const seen: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => seen.push(event));
        try {
            deliveryCallback(true, 'old', 'store', record, new Set(['a']), 1, () => undefined)();
            expect(calls).toBe(0);
            const queued = deliveryCallback(true, 'old', 'store', record, new Set(['a']), 2, () => record);
            stop();
            const resume = diagnostics.traceUpdates(event => seen.push(event));
            try {
                queued();
                expect(calls).toBe(1);
                expect(seen).toHaveLength(0);
            } finally { resume(); }
        } finally { stop(); }
    });
});
