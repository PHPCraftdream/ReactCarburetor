import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contract = file => join(root, 'perf', 'ci', 'contract', file);

let hashGateManifest, classifyBaselineGate;
const entry = max => [{id: 'x', scenario: 's', gates: [{metric: 'm', max}]}];
const O = entry(10), T = entry(8), L = entry(12);

let tmp;
const put = (path, content) => {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
};

const scaffold = (gateManifest, registry) => {
    tmp = mkdtempSync(join(tmpdir(), 'gate-freeze-'));
    put(join(tmp, 'perf', 'gates', 'g.mjs'), 'export default ' + JSON.stringify(gateManifest));
    const contractDir = join(tmp, 'perf', 'ci', 'contract');
    for (const file of ['gateContract.mjs', 'hashGate.mjs', 'check.mjs', 'registerGate.mjs'])
        put(join(contractDir, file), readFileSync(contract(file)));
    put(join(contractDir, 'gate-baseline.json'), JSON.stringify(registry, null, 2));
    put(join(contractDir, 'gate-amendments.json'), '{}');
    return contractDir;
};

const run = (cwd, script, args = []) => spawnSync(process.execPath, [join(cwd, script), ...args], {cwd: tmp, encoding: 'utf8'});

const registryFor = manifest => ({
    baseline: {sha: 't', files: {'g.mjs': {hash: hashGateManifest(manifest), manifest}}},
    frozen: {sha: 't', files: {}},
    registered: {sha: 'unreleased', files: {}}
});

describe('freeze contract end-to-end in a scratch tree', () => {
    beforeAll(async () => {
        ({hashGateManifest} = await import(pathToFileURL(contract('hashGate.mjs')).href));
        ({classifyBaselineGate} = await import(pathToFileURL(contract('gateContract.mjs')).href));
    });
    afterEach(() => {
        if (tmp) rmSync(tmp, {recursive: true, force: true});
        tmp = undefined;
    });

    it('accepts a registered unchanged gate', () => {
        const dir = scaffold(O, registryFor(O));
        const child = run(dir, 'check.mjs');
        expect(child.status).toBe(0);
        expect(child.stdout).toMatch(/0 errors/);
    });

    it('accepts a tightening with no git history at all', () => {
        const dir = scaffold(T, registryFor(O));
        const child = run(dir, 'check.mjs');
        expect(child.status).toBe(0);
        expect(child.stdout).toContain('tightened g.mjs');
    });

    it('rejects a loosening with no amendment', () => {
        const dir = scaffold(L, registryFor(O));
        const child = run(dir, 'check.mjs');
        expect(child.status).toBe(1);
        expect(child.stderr).toContain('Gate contract changed without amendment: g.mjs');
    });

    it('rejects an unregistered gate even with a matching amendment', () => {
        const dir = scaffold(O, registryFor(O));
        const reg = registryFor(O);
        delete reg.baseline.files['g.mjs'];
        put(join(tmp, 'perf', 'ci', 'contract', 'gate-baseline.json'), JSON.stringify(reg, null, 2));
        put(join(tmp, 'perf', 'ci', 'contract', 'gate-amendments.json'),
            JSON.stringify({'g.mjs': {sha256: hashGateManifest(O), reason: 'r', commit: 'c'}}));
        const child = run(dir, 'check.mjs');
        expect(child.status).toBe(1);
        expect(child.stderr).toContain('unregistered gate file: g.mjs');
    });

    it('maps one manifest to one decision on both the CLI and bench:ci paths', () => {
        expect(classifyBaselineGate({file: 'g.mjs', expectedHash: hashGateManifest(O),
            baselineManifest: O, manifest: T, amendmentHash: undefined})).toEqual({file: 'g.mjs', tightened: true});
        const dir = scaffold(L, registryFor(O));
        const child = run(dir, 'check.mjs');
        expect(child.status).toBe(1);
        const cliMessage = 'Gate contract changed without amendment: g.mjs';
        expect(child.stderr).toContain(cliMessage);
        expect(classifyBaselineGate({file: 'g.mjs', expectedHash: hashGateManifest(O),
            baselineManifest: O, manifest: L, amendmentHash: undefined}).error).toBe(cliMessage);
    });

    it('registerGate registers once, is idempotent and refuses rewrites', () => {
        const tmp2 = mkdtempSync(join(tmpdir(), 'gate-freeze-reg-'));
        tmp = tmp2;
        put(join(tmp2, 'perf', 'gates', 'n.mjs'), 'export default ' + JSON.stringify(O));
        const dir = join(tmp2, 'perf', 'ci', 'contract');
        for (const file of ['gateContract.mjs', 'hashGate.mjs', 'check.mjs', 'registerGate.mjs'])
            put(join(dir, file), readFileSync(contract(file)));
        put(join(dir, 'gate-baseline.json'), JSON.stringify(
            {baseline: {sha: 't', files: {}}, frozen: {sha: 't', files: {}}}, null, 2));
        put(join(dir, 'gate-amendments.json'), '{}');
        const regPath = join(dir, 'gate-baseline.json');
        let child = run(dir, 'registerGate.mjs', ['perf/gates/n.mjs']);
        expect(child.status).toBe(0);
        expect(child.stdout).toContain('n.mjs registered');
        expect(run(dir, 'check.mjs').status).toBe(0);
        const afterRegister = readFileSync(regPath, 'utf8');
        child = run(dir, 'registerGate.mjs', ['perf/gates/n.mjs']);
        expect(child.status).toBe(0);
        expect(child.stdout).toContain('already registered (unchanged)');
        expect(readFileSync(regPath, 'utf8')).toBe(afterRegister);
        put(join(tmp2, 'perf', 'gates', 'n.mjs'), 'export default ' + JSON.stringify(L));
        child = run(dir, 'registerGate.mjs', ['perf/gates/n.mjs']);
        expect(child.status).toBe(1);
        expect(child.stderr).toContain('changed since registration');
        expect(readFileSync(regPath, 'utf8')).toBe(afterRegister);
    });

    it('registerGate refuses a baseline-frozen file', () => {
        const dir = scaffold(O, registryFor(O));
        const child = run(dir, 'registerGate.mjs', ['perf/gates/g.mjs']);
        expect(child.status).toBe(1);
        expect(child.stderr).toContain('frozen at the baseline');
    });
});
