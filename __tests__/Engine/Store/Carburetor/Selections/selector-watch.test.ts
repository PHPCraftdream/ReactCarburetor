import {Carburetor, computed} from "@/Carburetor";
import {rstest} from "@rstest/core";
import {READS_TRANSFER} from "@/Carburetor/Store/Paths/Markers/ReadsTransferBrand";
import {getTestData, TestCarburetor} from "../fixtures";

/**
 * R16-10(1): `watch(select, onChange)` replaces the string-path `watch(callback, reads?)` form.
 * `select` runs against a tracked read view — the reads it touches become the subscription's
 * read set — and `onChange(next, previous)` fires only when the selection's content actually
 * changed, never on the initial call and never for a write that only moved the selector's reads.
 */
describe('watch(select, onChange)', () => {
    test('root primitive selection needs an ordinary read to follow value changes (R8-02)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const ordinary: Array<[number, number]> = [];
        const descriptor: Array<[number, number]> = [];
        const stopOrdinary = carburetor.watch((view) => view.a, (next, previous) => {
            ordinary.push([next, previous]);
        });
        const stopDescriptor = carburetor.watch(
            (view) => Object.getOwnPropertyDescriptor(view, 'a')?.value as number,
            (next, previous) => { descriptor.push([next, previous]); }
        );

        carburetor.setA(1);

        expect(ordinary).toEqual([[1, 0]]);
        expect(descriptor).toEqual([]);
        stopOrdinary();
        stopDescriptor();
    });

    test('nested primitive descriptor selection tracks traversal but not the leaf (R8-02)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const ordinary: Array<[number, number]> = [];
        const descriptor: Array<[number, number]> = [];
        const stopOrdinary = carburetor.watch((view) => view.nested.value, (next, previous) => {
            ordinary.push([next, previous]);
        });
        const stopDescriptor = carburetor.watch(
            (view) => Object.getOwnPropertyDescriptor(view.nested, 'value')?.value as number,
            (next, previous) => { descriptor.push([next, previous]); }
        );

        carburetor.setNestedValue(1);

        expect(ordinary).toEqual([[1, 0]]);
        expect(descriptor).toEqual([]);
        stopOrdinary();
        stopDescriptor();
    });

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

    test('transfers its read set into subscribe() instead of copying it (R6-04)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

        const dispose = carburetor.watch((data) => data.a, () => undefined);

        const options = subscribeSpy.mock.calls[0][1] as {reads?: unknown; [READS_TRANSFER]?: unknown};

        expect(options[READS_TRANSFER]).toBe(options.reads);

        dispose();
        subscribeSpy.mockRestore();
    });
});

class InheritedKeyStore extends Carburetor<Record<string, unknown>> {
    /** Installs a plain own data key without invoking Object.prototype's inherited setter. */
    public define(key: string, value: unknown): void {
        this.update(draft => {
            Object.defineProperty(draft, key, {
                value, writable: true, enumerable: true, configurable: true,
            });
        });
    }

    /** Removes the own key so the same inherited name becomes visible again. */
    public remove(key: string): void {
        this.update(draft => { delete draft[key]; });
    }
}

describe('plain-object inherited key becoming own data', () => {
    for (const key of ['toString', 'constructor', '__proto__']) {
        test(`${key} wakes watch, direct computed and computed chains on add and delete`, () => {
            const store = new InheritedKeyStore({});
            const previous = typeof (Object.prototype as Record<string, unknown>)[key];
            const changes: Array<[string, string]> = [];
            const directChanges: string[] = [];
            const chainChanges: string[] = [];
            let runs = 0;
            const direct = computed(read => {
                runs++;
                return typeof read(store)[key];
            });
            const chain = computed(read => read(direct) + '!');
            const stopWatch = store.watch(view => typeof view[key], (next, before) => {
                changes.push([next, before]);
            });
            const directId = direct.subscribe(() => directChanges.push(direct.get()));
            const chainId = chain.subscribe(() => chainChanges.push(chain.get()));

            expect(direct.get()).toBe(previous);
            expect(chain.get()).toBe(previous + '!');
            store.define('unrelated', 1);
            expect(changes).toEqual([]);
            expect(directChanges).toEqual([]);
            expect(chainChanges).toEqual([]);
            expect(runs).toBe(1);

            store.define(key, 7);
            expect(Object.getPrototypeOf(store.getData())).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(store.getData(), key)).toBe(true);
            expect(changes).toEqual([['number', previous]]);
            expect(direct.get()).toBe('number');
            expect(chain.get()).toBe('number!');
            expect(directChanges).toEqual(['number']);
            expect(chainChanges).toEqual(['number!']);

            store.define('unrelated', 2);
            expect(changes).toHaveLength(1);
            expect(directChanges).toHaveLength(1);
            expect(chainChanges).toHaveLength(1);

            store.remove(key);
            expect(Object.prototype.hasOwnProperty.call(store.getData(), key)).toBe(false);
            expect(changes).toEqual([['number', previous], [previous, 'number']]);
            expect(direct.get()).toBe(previous);
            expect(chain.get()).toBe(previous + '!');
            expect(directChanges).toEqual(['number', previous]);
            expect(chainChanges).toEqual(['number!', previous + '!']);

            stopWatch();
            direct.unsubscribe(directId);
            chain.unsubscribe(chainId);
        });
    }
    test('an inherited presence probe wakes when constructor becomes an own key', () => {
        const store = new InheritedKeyStore({});
        const changes: Array<[boolean, boolean]> = [];
        const dispose = store.watch(
            view => 'constructor' in view && Object.prototype.hasOwnProperty.call(view, 'constructor'),
            (next, previous) => changes.push([next, previous])
        );

        store.define('unrelated', 1);
        expect(changes).toEqual([]);
        store.define('constructor', 3);
        expect(changes).toEqual([[true, false]]);
        store.remove('constructor');
        expect(changes).toEqual([[true, false], [false, true]]);
        dispose();
    });
});

describe('tracked native collection keys resolve to their raw graph aliases', () => {
    interface IState {
        key: {id: number};
        map: Map<object, number>;
        set: Set<object>;
    }

    class NativeStore extends Carburetor<IState> {
        public put(value: number): void {
            this.update(draft => { draft.map.set(draft.key, value); });
        }
    }

    test('Map/Set reads, selected watch and computed follow the same tracked key', () => {
        const key = {id: 1};
        const store = new NativeStore({key, map: new Map([[key, 7]]), set: new Set([key])});
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        const changes: Array<[number | undefined, number | undefined]> = [];
        const stop = store.watch(data => data.map.get(data.key), (next, before) => {
            changes.push([next, before]);
        });
        const derived = computed(read => {
            const data = read(store);
            return data.map.get(data.key);
        });

        expect(view.map.get(view.key)).toBe(7);
        expect(view.map.has(view.key)).toBe(true);
        expect(view.set.has(view.key)).toBe(true);
        expect(view.map.get([...view.map.keys()][0])).toBe(7);
        expect(reads.has('map')).toBe(true);
        expect(reads.has('key.~p')).toBe(true);
        expect(derived.get()).toBe(7);

        store.put(8);
        expect(store.getData().map.size).toBe(1);
        expect(view.map.get(view.key)).toBe(8);
        expect(changes).toEqual([[8, 7]]);
        expect(derived.get()).toBe(8);
        stop();
    });
});
