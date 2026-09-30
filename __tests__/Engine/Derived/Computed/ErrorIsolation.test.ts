import {computed, diagnostics} from '@/Carburetor';
import {CounterCarburetor, ExternalComputed, ListCarburetor, getData} from './fixtures';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';

class FallibleCounter extends CounterCarburetor {
    public failSubscribe = false;
    public get listenerCount(): number { return Object.keys(this.subscribers).length; }
    public override subscribe(callback: () => void, options: ISubscribeOptions = {}): string {
        const id = super.subscribe(callback, options);
        if (this.failSubscribe) {
            throw new Error('store attachment failed');
        }
        return id;
    }
}

describe('computed', () => {
    describe('error isolation', () => {
        test('external settlement failure leaves another dependent live and preserves retry', () => {
            const source = new ExternalComputed(1);
            let poison = false;
            let healthyCalls = 0;
            let brokenCalls = 0;
            const broken = computed(read => {
                const value = read(source);
                if (poison) { throw new Error('external body failed'); }
                return value;
            });
            const healthy = computed(read => read(source) * 2);
            const brokenId = broken.subscribe(() => brokenCalls++);
            const healthyId = healthy.subscribe(() => healthyCalls++);
            poison = true;
            diagnostics.setEnabled(false);
            try { source.set(2); } finally { diagnostics.setEnabled(true); }
            expect(healthyCalls).toEqual(1);
            expect(brokenCalls).toEqual(0);
            expect(() => broken.get()).toThrow('external body failed');
            poison = false;
            source.set(3);
            expect(brokenCalls).toEqual(1);
            expect(healthyCalls).toEqual(2);
            broken.unsubscribe(brokenId);
            healthy.unsubscribe(healthyId);
            expect(source.listeners.size).toEqual(0);
        });

        test.each([undefined, 'chosen'])('a throwing first body rolls back registration %s', (id) => {
            const source = new ExternalComputed();
            let poison = true;
            let leaked = 0;
            const value = computed(read => {
                const result = read(source);
                if (poison) { throw new Error('first body failed'); }
                return result * 2;
            });
            expect(() => value.subscribe(() => leaked++, {id})).toThrow('first body failed');
            expect(source.listeners.size).toEqual(0);
            poison = false;
            const retry = value.subscribe(() => undefined);
            value.unsubscribe(retry);
            source.set(8);
            expect(source.listeners.size).toEqual(0);
            expect(leaked).toEqual(0);
            expect(value.get()).toEqual(16);
        });

        test.each([false, true])('failed first attachment rolls back edges after cached read %s', (cached) => {
            const first = new ExternalComputed(1, 'first');
            const failing = new ExternalComputed(2, 'failing');
            failing.failSubscribe = true;
            const value = computed(read => read(first) + read(failing));
            let leaked = 0;
            if (cached) { expect(value.get()).toEqual(3); }
            expect(() => value.subscribe(() => leaked++)).toThrow('attachment failed');
            expect(first.listeners.size).toEqual(0);
            expect(failing.listeners.size).toEqual(0);
            failing.failSubscribe = false;
            const retry = value.subscribe(() => undefined);
            expect(first.listeners.size).toEqual(1);
            expect(failing.listeners.size).toEqual(1);
            value.unsubscribe(retry);
            first.set(5);
            expect(first.listeners.size).toEqual(0);
            expect(failing.listeners.size).toEqual(0);
            expect(leaked).toEqual(0);
        });

        test('a failed native attachment releases earlier store and computed edges', () => {
            const first = new FallibleCounter({n: 1});
            const failing = new FallibleCounter({n: 2});
            const inner = computed(read => read(first).n);
            failing.failSubscribe = true;
            const outer = computed(read => read(inner) + read(failing).n);
            expect(() => outer.subscribe(() => undefined)).toThrow('store attachment failed');
            expect(first.listenerCount).toEqual(0);
            expect(failing.listenerCount).toEqual(0);
            failing.failSubscribe = false;
            const retry = outer.subscribe(() => undefined);
            expect(first.listenerCount).toEqual(1);
            expect(failing.listenerCount).toEqual(1);
            outer.unsubscribe(retry);
            expect(first.listenerCount).toEqual(0);
            expect(failing.listenerCount).toEqual(0);
        });

        test('a failed known-id replacement restores the old callback and retained edges', () => {
            const source = new FallibleCounter({n: 1});
            let poison = false;
            let oldCalls = 0;
            let replacementCalls = 0;
            const value = computed(read => {
                const n = read(source).n;
                if (poison) { throw new Error('replacement body failed'); }
                return n;
            });
            value.subscribe(() => oldCalls++, {id: 'chosen'});
            poison = true;
            diagnostics.setEnabled(false);
            try { source.setN(2); } finally { diagnostics.setEnabled(true); }
            expect(() => value.subscribe(() => replacementCalls++, {id: 'chosen'}))
                .toThrow('replacement body failed');
            expect(source.listenerCount).toEqual(1);
            poison = false;
            source.setN(3);
            expect(oldCalls).toEqual(1);
            expect(replacementCalls).toEqual(0);
            value.unsubscribe('chosen');
            expect(source.listenerCount).toEqual(0);
        });

        test('replacement attachment failure preserves the old graph and allows retry', () => {
            const source = new FallibleCounter({n: 1});
            const adopted = new ExternalComputed(10, 'adopted');
            let adopt = false;
            let poison = false;
            let oldCalls = 0;
            let replacementCalls = 0;
            const value = computed(read => {
                const data = read(source);
                if (poison) { throw new Error('hold invalid'); }
                return adopt ? Object.keys(data).length + read(adopted) : data.n;
            });
            value.subscribe(() => oldCalls++, {id: 'chosen'});
            poison = true;
            diagnostics.setEnabled(false);
            try { source.setN(2); } finally { diagnostics.setEnabled(true); }
            poison = false;
            adopt = true;
            adopted.failSubscribe = true;
            expect(() => value.subscribe(() => replacementCalls++, {id: 'chosen'}))
                .toThrow('attachment failed');
            expect(adopted.listeners.size).toEqual(0);
            expect(source.listenerCount).toEqual(1);
            adopt = false;
            source.setN(3);
            expect(oldCalls).toEqual(1);
            expect(replacementCalls).toEqual(0);
            adopted.failSubscribe = false;
            adopt = true;
            poison = true;
            diagnostics.setEnabled(false);
            try { source.setN(4); } finally { diagnostics.setEnabled(true); }
            poison = false;
            value.subscribe(() => replacementCalls++, {id: 'chosen'});
            adopted.set(11);
            expect(replacementCalls).toEqual(1);
            value.unsubscribe('chosen');
            expect(source.listenerCount).toEqual(0);
            expect(adopted.listeners.size).toEqual(0);
        });

        test('a throwing subscriber does not skip a later subscriber of the same computed', () => {
            const carburetor = new ListCarburetor(getData());
            let later = 0;

            const doneCount = computed<number>((read) => {
                const {items} = read(carburetor);

                return Object.keys(items).filter((id: string) => items[id].done).length;
            });

            doneCount.subscribe(() => {
                throw new Error('subscriber failed');
            }, {id: 'boom'});
            doneCount.subscribe(() => later++, {id: 'later'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            expect(later).toEqual(1);

            // The throw is reported through diagnostics, not re-thrown into whoever wrote.
            expect(reported.length).toEqual(1);
            expect(reported[0]).toContain('subscriber threw');
        });

        test('a throwing subscriber does not prevent an independent computed from being delivered', () => {
            const carburetor = new ListCarburetor(getData());
            let healthyNotified = 0;

            const broken = computed<boolean>((read) => read(carburetor).items.a.done);
            const healthy = computed<boolean>((read) => read(carburetor).items.a.done);

            broken.subscribe(() => {
                throw new Error('observer failed');
            }, {id: 'boom'});

            healthy.subscribe(() => healthyNotified++, {id: 'healthy'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            expect(healthyNotified).toEqual(1);
            expect(reported.length).toEqual(1);
            expect(reported[0]).toContain('subscriber threw');
        });

        test('a failing body is not announced as a success and does not suppress an independent computed', () => {
            const carburetor = new ListCarburetor(getData());
            // Start b undone, so the retry write below actually moves the value.
            carburetor.setDone('b', false);
            let poison = false;
            let brokenNotified = 0;
            let healthyNotified = 0;

            const broken = computed<number>((read) => {
                const {items} = read(carburetor);

                if (poison) {
                    throw new Error('body failed');
                }

                return (items.a.done ? 1 : 0) + (items.b.done ? 2 : 0);
            });

            const healthy = computed<number>((read) => (read(carburetor).items.a.done ? 10 : 0));

            broken.subscribe(() => brokenNotified++, {id: 'broken'});
            healthy.subscribe(() => healthyNotified++, {id: 'healthy'});

            expect(broken.get()).toEqual(0);

            poison = true;

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            // The independent computed was delivered; the failed one stayed silent.
            expect(healthyNotified).toEqual(1);
            expect(brokenNotified).toEqual(0);
            expect(reported.length).toEqual(1);

            // The old value is not announced as a fresh success: the version stands still and
            // an explicit read exposes the failure to its reader.
            expect(broken.getVersion()).toEqual(0);
            expect(() => broken.get()).toThrow('body failed');

            // Clearing the cause and writing again retries the body; delivery resumes.
            poison = false;

            carburetor.setDone('b', true);

            expect(brokenNotified).toEqual(1);
            expect(broken.get()).toEqual(3);
        });

        test('work queued during delivery is completed even when another settlement fails', () => {
            const carburetor = new ListCarburetor(getData());
            // Start b undone, so the mid-delivery write actually moves the value.
            carburetor.setDone('b', false);
            let poison = false;
            let healthyNotified = 0;
            let cascades = 0;

            const broken = computed<number>((read) => {
                const {items} = read(carburetor);

                if (poison) {
                    throw new Error('body failed');
                }

                return items.a.done ? 1 : 0;
            });

            const healthy = computed<number>((read) => {
                const {items} = read(carburetor);

                return (items.a.done ? 1 : 0) + (items.b.done ? 2 : 0);
            });

            broken.subscribe(() => undefined, {id: 'broken'});

            healthy.subscribe(() => {
                healthyNotified++;

                // The first delivery writes again, so a fresh settlement queues mid-drain.
                if (cascades++ === 0) {
                    carburetor.setDone('b', true);
                }
            }, {id: 'healthy'});

            poison = true;

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            // healthy settled once for the write, and once more for the write its own delivery
            // made — the failing computation did not strand that queued work.
            expect(healthyNotified).toEqual(2);
            expect(reported.length).toBeGreaterThan(0);
        });

        test('delivery stays isolated with diagnostics switched off', () => {
            const carburetor = new ListCarburetor(getData());
            let later = 0;

            const doneCount = computed<number>((read) => {
                const {items} = read(carburetor);

                return Object.keys(items).filter((id: string) => items[id].done).length;
            });

            doneCount.subscribe(() => {
                throw new Error('subscriber failed');
            }, {id: 'boom'});
            doneCount.subscribe(() => later++, {id: 'later'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);
            diagnostics.setEnabled(false);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                diagnostics.setEnabled(true);
                console.error = original;
            }

            // Delivery behaves the same with diagnostics off: the later subscriber is still
            // woken, and nothing is reported.
            expect(later).toEqual(1);
            expect(reported).toEqual([]);
        });
    });

});
