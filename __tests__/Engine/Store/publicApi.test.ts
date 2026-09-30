import {rstest} from "@rstest/core";
import * as api from "@/Carburetor";
import {Carburetor, CarburetorHistory, Diagnostics} from "@/Carburetor";

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
