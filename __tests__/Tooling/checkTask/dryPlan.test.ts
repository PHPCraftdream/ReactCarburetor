import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const script = join(root, 'scripts', 'affected.mjs');

function run(args) {
    return spawnSync(process.execPath, [script, '--task', ...args], {cwd: root, encoding: 'utf8'});
}

describe('affected.mjs --task dry plan', () => {
    it('resource file: no full-tier message, rstest path listed, exit 0', () => {
        const r = run(['--dry', '--files', 'lib/src/Carburetor/Resource/x.ts']);
        expect(r.status).toBe(0);
        expect(r.stdout).not.toContain('full tier required');
        expect(r.stdout).toContain('__tests__/Engine/Resource');
    });

    it('store file: dry run exits 0 with the full-tier message', () => {
        const r = run(['--files', 'lib/src/Carburetor/Store/z.ts', '--dry']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('full tier required: gh workflow run ci.yml (see docs/testing-tiers.md)');
    });

    it('store file without --dry: full tier runs nothing and exits 2', () => {
        const r = run(['--files', 'lib/src/Carburetor/Store/z.ts']);
        expect(r.status).toBe(2);
        expect(r.stdout).toContain('full tier required');
        expect(r.stdout).not.toContain('would run');
    });
}, 60000);
