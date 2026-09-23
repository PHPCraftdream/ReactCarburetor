import * as api from "@/Carburetor";

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
    'SubscriberIndex',
    'SyncUpdateScheduler',
    'WILDCARD_PATH',
    'bind',
    'carburetorToken',
    'computed',
    'connectDevTools',
    'deepClone',
    'encodeCacheKey',
    'diagnostics',
    'getInitialCacheEntry',
    'getInitialResourceData',
    'getUid',
    'isTrackable',
    'pathsIntersect',
    'persist',
    'shallowEqual',
    'syncUpdateScheduler',
    'transaction',
    'waitForUpdate',
];

const INTERNALS: string[] = [
    'createProxyCache',
    'createReadProxy',
    'createWriteProxy',
    'escapeCacheKey',
    'joinPath',
    'PATH_SEPARATOR',
    'UpdateBatch',
    'updateBatch',
    'IS_DEVELOPMENT',
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
