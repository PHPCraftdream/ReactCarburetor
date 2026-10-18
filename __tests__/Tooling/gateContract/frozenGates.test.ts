import {spawnSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contract = file => join(root, 'perf', 'ci', 'contract', file);
const url = file => pathToFileURL(contract(file)).href;

describe('frozen gate contract', () => {
    it('check.mjs passes on the current tree', () => {
        const child = spawnSync(process.execPath, [contract('check.mjs')], {cwd: root, encoding: 'utf8'});
        expect(child.stderr).toBe('');
        expect(child.status).toBe(0);
        expect(child.stdout).toMatch(/0 errors/);
    });

    it('classifyGateChange accepts identical, amended and tightened hashes and rejects the rest', () => {
        const expression = `import {classifyGateChange} from ${JSON.stringify(url('gateContract.mjs'))};
const entry = gates => [{id: 'x', scenario: 's', gates}];
const max = (value) => [{metric: 'Ms', max: value}];
const rows = {
    identical: classifyGateChange({file: 'g.mjs', registered: true, expectedHash: 'aaa', actualHash: 'aaa'}),
    amended: classifyGateChange({
        file: 'g.mjs', registered: true, expectedHash: 'aaa', actualHash: 'bbb', amendmentHash: 'bbb',
    }),
    tightened: classifyGateChange({file: 'g.mjs', registered: true, expectedHash: 'aaa', actualHash: 'bbb',
        baselineManifest: entry(max(10)), manifest: entry(max(8))}),
    raised: classifyGateChange({file: 'g.mjs', registered: true, expectedHash: 'aaa', actualHash: 'bbb',
        baselineManifest: entry(max(10)), manifest: entry(max(12))}),
    amendmentMismatch: classifyGateChange({
        file: 'g.mjs', registered: true, expectedHash: 'aaa', actualHash: 'bbb', amendmentHash: 'ccc',
        baselineManifest: entry(max(10)), manifest: entry(max(12))}),
    unregistered: classifyGateChange({file: 'g.mjs', actualHash: 'bbb'}),
    unregisteredWithAmendment: classifyGateChange({file: 'g.mjs', actualHash: 'bbb', amendmentHash: 'bbb'})
};
console.log(JSON.stringify(rows, (key, value) => value === undefined ? null : value));`;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', expression], {encoding: 'utf8'});
        expect(child.status).toBe(0);
        expect(child.stderr).toBe('');
        const rows = JSON.parse(child.stdout);
        expect(rows.identical).toEqual({file: 'g.mjs', amended: false});
        expect(rows.amended).toEqual({file: 'g.mjs', amended: true});
        expect(rows.tightened).toEqual({file: 'g.mjs', tightened: true});
        expect(rows.raised.error).toBe('Gate contract changed without amendment: g.mjs');
        expect(rows.amendmentMismatch.error).toBe('Amendment hash mismatch: g.mjs');
        expect(rows.unregistered.error).toContain('unregistered');
        expect(rows.unregisteredWithAmendment.error).toContain('unregistered');
    });

    it('gate-baseline.json registers every gate file exactly once with verifiable entries', () => {
        const doc = JSON.parse(readFileSync(contract('gate-baseline.json'), 'utf8'));
        const onDisk = readdirSync(join(root, 'perf', 'gates')).filter(name => name.endsWith('.mjs')).sort();
        expect(Object.hasOwn(doc.registered.files, 'dev.mjs')).toBe(true);
        const union = [
            ...Object.keys(doc.baseline.files), ...Object.keys(doc.frozen.files), ...Object.keys(doc.registered.files),
        ].sort();
        expect(union).toEqual(onDisk);
        expect(new Set(union).size).toBe(union.length);
        for (const section of ['baseline', 'frozen', 'registered'] as const)
            for (const entry of Object.values(doc[section].files)) {
                expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
                expect(Array.isArray(entry.manifest)).toBe(true);
            }
    });

    it('every consumer uses the single classifier', () => {
        for (const file of ['run.mjs', 'compare.mjs']) {
            const text = readFileSync(join(root, 'perf', 'ci', file), 'utf8');
            expect(text).toContain('classifyBaselineGate');
            expect(text).not.toContain('gateContractStatus');
        }
        const check = readFileSync(contract('check.mjs'), 'utf8');
        expect(check).toContain('classifyGateChange');
        expect(check).not.toContain('gateContractStatus');
    });
});
