import {computed, diagnostics} from '@/Carburetor';
import {ListCarburetor, getData} from './fixtures';

describe('computed', () => {
    describe('error isolation', () => {
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
