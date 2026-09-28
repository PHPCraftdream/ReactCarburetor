import {getTestData, TestCarburetor} from "./fixtures";

/**
 * R16-10(1): `watch(select, onChange)` replaces the string-path `watch(callback, reads?)` form.
 * `select` runs against a tracked read view — the reads it touches become the subscription's
 * read set — and `onChange(next, previous)` fires only when the selection's content actually
 * changed, never on the initial call and never for a write that only moved the selector's reads.
 */
describe('watch(select, onChange)', () => {
    test('does not call onChange on subscribe', () => {
        const carburetor = new TestCarburetor(getTestData());
        const calls: Array<[number, number]> = [];

        const dispose = carburetor.watch((data) => data.a, (next, previous) => {
            calls.push([next, previous]);
        });

        expect(calls).toEqual([]);
        dispose();
    });

    test('fires only when the selection changes, not on every matching write', () => {
        const carburetor = new TestCarburetor(getTestData());
        const calls: Array<[boolean, boolean]> = [];

        // Reads `a`, but its own result can stay put across a real, recorded write to `a` —
        // the case a dedupe at the proxy's own no-op guard (same value written twice) cannot
        // cover, since every write here changes the stored value.
        const dispose = carburetor.watch((data) => data.a > 0, (next, previous) => {
            calls.push([next, previous]);
        });

        carburetor.setA(1);
        expect(calls).toEqual([[true, false]]);

        // a: 1 -> 2 is a real write (recorded, wakes the subscription), but `a > 0` still reads
        // true, so onChange must not fire a second time.
        carburetor.setA(2);
        expect(calls).toEqual([[true, false]]);

        carburetor.setA(0);
        expect(calls).toEqual([[true, false], [false, true]]);

        dispose();
    });

    test('is not woken by a write outside the selector\'s read set', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        const dispose = carburetor.watch((data) => data.a, () => {
            calls++;
        });

        carburetor.setB(5);
        carburetor.setNestedValue(9);

        expect(calls).toEqual(0);

        dispose();
    });

    test('the disposer stops further notifications', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        const dispose = carburetor.watch((data) => data.a, () => {
            calls++;
        });

        carburetor.setA(1);
        expect(calls).toEqual(1);

        dispose();
        carburetor.setA(2);

        expect(calls).toEqual(1);
    });

    test('re-tracks reads when the selector\'s own branch moves', () => {
        const data = getTestData();

        data.nested.value = 7;
        data.b = 9;

        const carburetor = new TestCarburetor(data);
        const calls: Array<[number, number]> = [];

        // Reads `nested.value` while `a` is 0, `b` once it is not — a conditional selector
        // whose read set depends on which branch it took last.
        const dispose = carburetor.watch(
            (view) => (view.a === 0 ? view.nested.value : view.b),
            (next, previous) => {
                calls.push([next, previous]);
            }
        );

        // Flips the branch and changes the selection in the same write: onChange fires with
        // the old (nested.value) and new (b) content, and the subscription now reads `a`/`b`.
        carburetor.setA(1);
        expect(calls).toEqual([[9, 7]]);

        // No longer subscribed to `nested.value`: this write must not wake it.
        carburetor.setNestedValue(100);
        expect(calls).toEqual([[9, 7]]);

        // `b` is in the re-tracked read set, and its own write changes the selection again.
        carburetor.setB(20);
        expect(calls).toEqual([[9, 7], [20, 9]]);

        dispose();
    });

    test('a throwing selector is isolated like any other subscriber\'s throw', () => {
        const carburetor = new TestCarburetor(getTestData());
        let otherCalls = 0;
        let watchCalls = 0;
        const original = console.error;
        const reported: string[] = [];

        // notifyWrites reports an isolated throw through console.error (dev-only diagnostics);
        // captured here per the suite's console contract instead of leaking to the recorder.
        console.error = (message: string) => reported.push(message);

        carburetor.subscribe(() => otherCalls++, {id: 'other'});

        const throwing = carburetor.watch(
            (data) => {
                if (data.a === 1) {
                    throw new Error('boom');
                }

                return data.a;
            },
            () => {
                watchCalls++;
            }
        );

        try {
            expect(() => carburetor.setA(1)).not.toThrow();
        } finally {
            console.error = original;
        }

        // The write already landed, and the other subscriber — registered first — still heard it,
        // exactly as notifyWrites isolates any other throwing subscriber.
        expect(otherCalls).toEqual(1);
        expect(watchCalls).toEqual(0);
        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('boom');

        throwing();
    });
});
