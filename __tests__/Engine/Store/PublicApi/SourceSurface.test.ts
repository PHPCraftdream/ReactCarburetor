import * as Carburetor from '@/Carburetor';

/** The public surface of `react-carburetor`, pinned name by name: anything not on
 * this list fails here before it can slip under the semver contract. */
const PUBLIC_SURFACE = [
    'AntiHookComponent',
    'Carburetor',
    'CarburetorChildScope',
    'CarburetorContext',
    'CarburetorHistory',
    'CarburetorProvider',
    'CarburetorScope',
    'ComponentUpdateThrottle',
    'Computed',
    'Diagnostics',
    'EDevToolsAction',
    'EDevToolsMessageType',
    'EResourceStatus',
    'ResourceCache',
    'ResourceCarburetor',
    'ScopedAntiHookComponent',
    'UpdateThrottle',
    'action',
    'bind',
    'carburetorToken',
    'computed',
    'connectDevTools',
    'deepClone',
    'diagnostics',
    'getInitialResourceData',
    'persist',
    'resourceState',
    'shallowEqual',
    'transaction',
    'waitForUpdate',
].sort();

describe('public source surface', () => {
    test('root entry exports exactly the whitelisted names', () => {
        expect(Object.keys(Carburetor).sort()).toEqual(PUBLIC_SURFACE);
        expect(Carburetor).not.toHaveProperty('testing');
    });
});
