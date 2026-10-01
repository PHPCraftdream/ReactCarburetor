import {rstest} from "@rstest/core";
import * as api from "@/Carburetor";
import {Carburetor, CarburetorHistory, Diagnostics} from "@/Carburetor";
import type {ICarburetor, ICarburetorSubscription, IInspectable} from "@/Carburetor";
import {CARBURETOR_EXTEND, CARBURETOR_HAS_DRIFT} from "@/Carburetor/Store/Utils/Models";

/**
 * Snapshot of the runtime surface of the package. Type-only exports do not appear here,
 * which is fine: this guards the part that carries a semver contract at runtime, and it
 * fails loudly when an internal (a tracking proxy, the batch coordinator, path plumbing)
 * is exported by accident.
 */
const EXPECTED_EXPORTS: string[] = [
    'AntiHookComponent',
    'CarburetorContext',
    'CarburetorHistory',
    'CarburetorProvider',
    'CarburetorScope',
    'Carburetor',
    'ComponentUpdateThrottle',
    'Computed',
    'Diagnostics',
    'EDevToolsAction',
    'EDevToolsMessageType',
    'EResourceStatus',
    'ResourceCache',
    'ResourceCarburetor',
    'ScopedAntiHookComponent',
    'bind',
    'carburetorToken',
    'computed',
    'connectDevTools',
    'deepClone',
    'encodeCacheKey',
    'diagnostics',
    'getInitialCacheEntry',
    'getInitialResourceData',
    'persist',
    'shallowEqual',
    'transaction',
    'waitForUpdate',
];

const INTERNALS: string[] = [
    'createProxyCache',
    'createReadProxy',
    'createWriteProxy',
    'escapeCacheKey',
    'getUid',
    'isTrackable',
    'joinPath',
    'pathsIntersect',
    'PATH_SEPARATOR',
    'SubscriberIndex',
    'SyncUpdateScheduler',
    'syncUpdateScheduler',
    'UpdateBatch',
    'updateBatch',
    'IS_DEVELOPMENT',
    // R16-10(1): the path grammar is an engine internal, not a stable format — subscribe with
    // no `reads` reaches the same "every write" effect without naming this constant.
    'WILDCARD_PATH',
];

describe('public API', () => {
    test('exports exactly the curated surface', () => {
        expect(Object.keys(api).sort()).toEqual([...EXPECTED_EXPORTS].sort());
    });

    test('keeps internals out of the package entry point', () => {
        const exported = Object.keys(api);

        INTERNALS.forEach((name: string) => {
            expect(exported).not.toContain(name);
        });
    });
});

// R30-06a/R30-06b: `extend`/`hasDriftSince` moved to an internal symbol-keyed protocol and
// `serialize()` was removed in favour of the `toJSON()` wire form — neither may return to the
// public interfaces or the package barrel.
describe('surface after the internal subscription protocol (R30-06)', () => {
    test('the interfaces no longer carry extend, hasDriftSince or serialize, and keep snapshot', () => {
        // Each alias is `false` only while the member stays off the interface, so a member coming
        // back fails compilation here before it can ship.
        type HasExtend = 'extend' extends keyof ICarburetor ? true : false;
        type HasDrift = 'hasDriftSince' extends keyof ICarburetorSubscription ? true : false;
        type HasSerialize = 'serialize' extends keyof ICarburetor ? true : false;
        type HasSnapshot = 'snapshot' extends keyof IInspectable ? true : false;

        const withoutExtend: HasExtend = false;
        const withoutDrift: HasDrift = false;
        const withoutSerialize: HasSerialize = false;
        const withSnapshot: HasSnapshot = true;

        expect(withoutExtend).toBe(false);
        expect(withoutDrift).toBe(false);
        expect(withoutSerialize).toBe(false);
        expect(withSnapshot).toBe(true);
    });

    test('the barrel does not export the internal subscription symbols', () => {
        const pkg = api as Record<string, unknown>;

        expect(pkg.CARBURETOR_EXTEND).toBeUndefined();
        expect(pkg.CARBURETOR_HAS_DRIFT).toBeUndefined();
    });

    test('a store answers the internal protocol under symbol keys, not named members', () => {
        const store = new Carburetor({value: 1});
        const protocol = store as unknown as Record<symbol, unknown>;

        expect('extend' in store).toBe(false);
        expect('hasDriftSince' in store).toBe(false);
        expect(typeof protocol[CARBURETOR_EXTEND]).toBe('function');
        expect(typeof protocol[CARBURETOR_HAS_DRIFT]).toBe('function');
    });
});

// R15-07: canUndo/canRedo/undo/redo/clear/disconnect/record/apply were arrow fields, so a
// subclass method override of any of them was silently ignored, and super.x() could not reach
// a base arrow field.
describe('CarburetorHistory subclass method overrides', () => {
    interface ICounterData {
        value: number;
    }

    class CounterCarburetor extends Carburetor<ICounterData> {
        public setValue = (value: number) => {
            this.draft.value = value;

            this.emitUpdate();
        };
    }

    test('undo() is called and super.undo still steps back', () => {
        const calls: number[] = [];

        class LoggingHistory extends CarburetorHistory<ICounterData> {
            public undo(): boolean {
                calls.push(1);

                return super.undo();
            }
        }

        const carburetor = new CounterCarburetor({value: 0});
        const history = new LoggingHistory(carburetor);

        carburetor.setValue(1);

        expect(history.undo()).toBeTruthy();
        expect(calls).toEqual([1]);
        expect(carburetor.getData().value).toEqual(0);

        history.disconnect();
    });

    test('redo() is called and super.redo still steps forward', () => {
        const calls: number[] = [];

        class LoggingHistory extends CarburetorHistory<ICounterData> {
            public redo(): boolean {
                calls.push(1);

                return super.redo();
            }
        }

        const carburetor = new CounterCarburetor({value: 0});
        const history = new LoggingHistory(carburetor);

        carburetor.setValue(1);
        history.undo();

        expect(history.redo()).toBeTruthy();
        expect(calls).toEqual([1]);
        expect(carburetor.getData().value).toEqual(1);

        history.disconnect();
    });

    test('canUndo() is called and super.canUndo still answers correctly', () => {
        const calls: number[] = [];

        class LoggingHistory extends CarburetorHistory<ICounterData> {
            public canUndo(): boolean {
                calls.push(1);

                return super.canUndo();
            }
        }

        const carburetor = new CounterCarburetor({value: 0});
        const history = new LoggingHistory(carburetor);

        expect(history.canUndo()).toBeFalsy();

        carburetor.setValue(1);

        expect(history.canUndo()).toBeTruthy();
        expect(calls).toEqual([1, 1]);

        history.disconnect();
    });

    test('record() is called through the detached watch callback, and super.record still records the write', () => {
        const calls: number[] = [];

        class LoggingHistory extends CarburetorHistory<ICounterData> {
            protected record(): void {
                calls.push(1);
                super.record();
            }
        }

        const carburetor = new CounterCarburetor({value: 0});
        const history = new LoggingHistory(carburetor);

        carburetor.setValue(1);
        carburetor.setValue(2);

        expect(calls).toEqual([1, 1]);
        expect(history.undo()).toBeTruthy();
        expect(carburetor.getData().value).toEqual(1);

        history.disconnect();
    });
});

// R15-07: isEnabled/setEnabled/report were arrow fields, so a subclass method override was
// silently ignored.
describe('Diagnostics subclass method overrides', () => {
    test('report() is called and super.report still writes to the console', () => {
        const calls: string[] = [];
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            class LoggingDiagnostics extends Diagnostics {
                public report(message: string): void {
                    calls.push(message);
                    super.report(message);
                }
            }

            const diagnostics = new LoggingDiagnostics();
            diagnostics.setEnabled(true);
            diagnostics.report('something went wrong');

            expect(calls).toEqual(['something went wrong']);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('something went wrong');
        } finally {
            errorSpy.mockRestore();
        }
    });
});
