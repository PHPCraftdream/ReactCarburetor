import {Carburetor, CarburetorHistory, computed, transaction} from '@/Carburetor';
import {updateBatch} from '@/Carburetor/Store/Transaction/UpdateBatchInstance';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';

interface IData {value: number}
interface IEvents {saved: {value: number}; tick: void}

class EventStore extends Carburetor<IData, IEvents> {
    public save(value: number): void {
        this.draft.value = value;
        this.emit('saved', {value});
        this.emitUpdate();
    }
    public emitSaved(value: number): void { this.emit('saved', {value}); }
    public tick(): void { this.emit('tick', undefined); }
}

describe('one-off store events', () => {
    test('delivers synchronously in emit and registration order; disposer is idempotent', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        const off = store.on('saved', event => calls.push(`first:${event.value}`));
        store.on('saved', event => calls.push(`second:${event.value}`));
        store.save(3);
        expect(calls).toEqual(['first:3', 'second:3']);
        off(); off();
        store.save(4);
        expect(calls).toEqual(['first:3', 'second:3', 'second:4']);
    });

    test('one callback can be registered independently', () => {
        const store = new EventStore({value: 0});
        const calls: number[] = [];
        const callback = (): void => { calls.push(1); };
        const off = store.on('tick', callback);
        store.on('tick', callback);
        off(); store.tick();
        expect(calls).toEqual([1]);
    });

    test('transaction captures listeners and preserves inter-store FIFO', () => {
        const first = new EventStore({value: 0});
        const second = new EventStore({value: 0});
        const calls: string[] = [];
        first.on('saved', () => calls.push('A'));
        second.on('saved', () => calls.push('B'));
        transaction(() => {
            first.save(1);
            second.save(1);
            first.save(2);
            first.on('saved', () => calls.push('late'));
        });
        expect(calls).toEqual(['A', 'B', 'A']);
    });

    test('state notification follows settled update wave and events follow notification', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        const total = computed(read => read(store).value * 2);
        store.on('saved', () => calls.push(`event:${total.get()}`));
        store.subscribe(() => calls.push('state'));
        transaction(() => store.save(2));
        expect(calls).toEqual(['state', 'event:4']);
    });

    test('settlement writes are notified before queued events drain', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        store.on('tick', () => calls.push(`event:${store.getData().value}`));
        store.subscribe(() => calls.push(`state:${store.getData().value}`));

        updateBatch.begin();
        updateBatch.add(store, new Set());
        updateWave.defer('settlement-write', () => {
            transaction(() => store.save(2));
        });
        updateBatch.enqueueAfterFlush(() => store.tick());
        updateBatch.end();

        expect(calls).toEqual(['state:0', 'state:2', 'event:2']);
    });

    test('listener added during delivery waits until the next emit', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        store.on('saved', () => {
            calls.push('first');
            store.on('saved', () => calls.push('late'));
        });
        store.save(1);
        expect(calls).toEqual(['first']);
        store.save(2);
        expect(calls).toEqual(['first', 'first', 'late']);
    });

    test('throwing transaction still delivers captured events and leaves later batches usable', () => {
        const store = new EventStore({value: 0});
        const calls: number[] = [];
        store.on('saved', event => calls.push(event.value));
        expect(() => transaction(() => {
            store.save(1);
            throw new Error('transaction failed');
        })).toThrow('transaction failed');
        expect(calls).toEqual([1]);
        transaction(() => store.save(2));
        expect(calls).toEqual([1, 2]);
    });

    test('nested and repeated event-only transactions retain FIFO order', () => {
        const store = new EventStore({value: 0});
        const calls: number[] = [];
        store.on('tick', () => calls.push(1));
        transaction(() => {
            store.tick();
            transaction(() => { store.tick(); store.tick(); });
            store.tick();
        });
        expect(calls).toEqual([1, 1, 1, 1]);
    });

    test('listener transaction cannot interleave events ahead of outer FIFO', () => {
        const first = new EventStore({value: 0});
        const second = new EventStore({value: 0});
        const calls: string[] = [];
        let triggered = false;
        let outerWrites = 0;
        first.on('saved', () => {
            calls.push('A');
            if (!triggered) {
                triggered = true;
                transaction(() => first.tick());
            }
        });
        first.on('tick', () => calls.push('nested'));
        second.on('saved', () => calls.push('B'));
        first.subscribe(() => { outerWrites++; if (outerWrites === 1) transaction(() => first.save(8)); });
        first.subscribe(() => calls.push('state-A'));
        second.subscribe(() => calls.push('state-B'));
        transaction(() => { first.save(1); second.save(1); });
        expect(calls).toContain('state-A');
        expect(calls.indexOf('state-A')).toBeLessThan(calls.indexOf('state-B'));
        expect(calls.indexOf('state-B')).toBeLessThan(calls.indexOf('A'));
        expect(calls.indexOf('A')).toBeLessThan(calls.indexOf('B'));
        expect(calls.indexOf('nested')).toBeGreaterThan(calls.indexOf('B'));
    });

    test('unsubscribe during delivery skips a captured listener removed before its turn', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        let offSecond = (): void => {};
        store.on('saved', () => { calls.push('first'); offSecond(); });
        offSecond = store.on('saved', () => calls.push('second'));
        store.emitSaved(1);
        expect(calls).toEqual(['first']);
        store.emitSaved(2);
        expect(calls).toEqual(['first', 'first']);
    });

    test('nested synchronous event delivery is inline', () => {
        const store = new EventStore({value: 0});
        const calls: string[] = [];
        let nested = false;
        store.on('tick', () => {
            calls.push('start');
            if (!nested) { nested = true; store.tick(); }
            calls.push('end');
        });
        store.tick();
        expect(calls).toEqual(['start', 'start', 'end', 'end']);
    });

    test('event delivery leaves state, version, snapshots, history, and wire data independent', () => {
        const store = new EventStore({value: 0});
        const history = new CarburetorHistory(store);
        const snapshot = store.snapshot();
        const version = store.getVersion();
        let events = 0;
        store.on('tick', () => events++);
        store.tick();
        expect(events).toBe(1);
        expect(history.canUndo()).toBe(false);
        expect(store.getVersion()).toBe(version);
        expect(store.getData()).toEqual({value: 0});
        expect(snapshot).toEqual({value: 0});
        expect(store.toJSON()).toEqual({value: 0});
        expect(store.captureHistory(value => value)).toEqual({value: 0});
        history.disconnect();
    });

    test('throwing listeners and reporters are isolated', () => {
        const store = new EventStore({value: 0});
        const original = console.error;
        console.error = () => { throw new Error('report failed'); };
        const calls: string[] = [];
        store.on('saved', () => { throw new Error('listener failed'); });
        store.on('saved', () => calls.push('later'));
        try { expect(() => store.save(1)).not.toThrow(); } finally { console.error = original; }
        expect(calls).toEqual(['later']);
    });

    test('dispose cancels pending delivery and future registration', () => {
        const store = new EventStore({value: 0});
        let calls = 0;
        store.on('saved', () => calls++);
        transaction(() => { store.save(1); store.dispose(); store.dispose(); });
        store.on('saved', () => calls++);
        store.tick();
        expect(calls).toBe(0);
    });
});
