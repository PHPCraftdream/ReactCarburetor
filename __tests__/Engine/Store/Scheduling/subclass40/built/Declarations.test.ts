import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root = process.cwd();

describe('R40-01 built subclass contract', () => {
    test('built store declarations expose exactly the protected whitelist', () => {
        const text = readFileSync(resolve(root, 'dist/esm/Carburetor/Store/Carburetor.d.mts'), 'utf8');
        const members = [...text.matchAll(/^\s+protected (?:get )?(\w+)/gm)]
            .map(match => match[1]).sort((a, b) => a.localeCompare(b));
        expect(members).toEqual(['data', 'didSetData', 'draft', 'emitSoon', 'emitUpdate',
            'markAllChanged', 'preEmit', 'update'].sort());
        expect(text).toMatch(/protected get data\(\): T;/);
        expect(text).not.toMatch(/set data\(/);
        expect(text).toMatch(/protected preEmit\([^)]*ReadonlySet<string>\)/);
        for (const name of ['commitState', 'touchDraft', 'recordWrite', 'rememberPublication']) {
            expect(text).not.toMatch(new RegExp(`^\\s+(?:protected )?${name}\\(`, 'm'));
        }
    });

    test('the complete built namespace contains no internal symbol groups', async () => {
        const api = await import('../../../../../../dist/esm/Carburetor/index.mjs');
        expect(Object.keys(api).sort()).toEqual([
            'AntiHookComponent', 'Carburetor', 'CarburetorContext', 'CarburetorHistory', 'CarburetorProvider',
            'CarburetorScope', 'ComponentUpdateThrottle', 'Computed', 'Diagnostics', 'EDevToolsAction',
            'EDevToolsMessageType', 'EResourceStatus', 'ResourceCache', 'ResourceCarburetor',
            'ScopedAntiHookComponent', 'bind', 'carburetorToken', 'computed', 'connectDevTools', 'deepClone',
            'diagnostics', 'getInitialResourceData', 'persist', 'shallowEqual', 'transaction', 'waitForUpdate',
        ].sort());
    });

    test('component prototype string names contain only documented APIs and lifecycle', async () => {
        const {AntiHookComponent} = await import('../../../../../../dist/esm/Carburetor/index.mjs');
        const names = new Set<string>();
        let prototype = AntiHookComponent.prototype;
        while (prototype && prototype.constructor.name !== 'Component') {
            for (const name of Object.getOwnPropertyNames(prototype)) {
                if (name !== 'constructor') names.add(name);
            }
            prototype = Object.getPrototypeOf(prototype);
        }
        expect([...names].sort()).toEqual(['componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
            'connect', 'connectSelection', 'shouldComponentUpdate', 'unUseEffects', 'useCarburetor',
            'useComputed', 'useEffect', 'useEffects', 'useResource'].sort());
    });

    test('strict consumer fixture compiles against dist declarations', () => {
        execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit',
            '-p', resolve(root, '__tests__/Engine/Store/Scheduling/subclass40/built/tsconfig.json')],
        {cwd: root, stdio: 'pipe'});
    });
});
