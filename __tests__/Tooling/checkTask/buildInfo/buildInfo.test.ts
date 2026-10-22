import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceHash} from '../../../../scripts/tools/buildInfo/sourceHash.mjs';

const checker = fileURLToPath(new URL('../../../../scripts/tools/buildInfo/checkDistFresh.mjs', import.meta.url));

describe('build stamp freshness', () => {
    let root: string;
    const writeSource = (text: string) => writeFileSync(join(root, 'lib/src/example.ts'), text);
    const makeFixture = () => {
        root = mkdtempSync(join(tmpdir(), 'build-info-'));
        mkdirSync(join(root, 'lib/src'), {recursive: true});
        mkdirSync(join(root, 'plugin/src'), {recursive: true});
        mkdirSync(join(root, 'dist'), {recursive: true});
        writeSource('export {};\n');
        writeFileSync(join(root, 'plugin/src/example.mts'), 'export {};\n');
        writeFileSync(join(root, 'rslib.config.ts'), 'config\n');
        writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'fixture', version: '1.0.0'}));
    };
    const run = () => spawnSync(process.execPath, [checker, root], {encoding: 'utf8'});
    const stamp = () => writeFileSync(join(root, 'dist/build-info.json'), JSON.stringify({
        name: 'fixture', version: '1.0.0', sourceHash: sourceHash(root),
    }));

    beforeEach(makeFixture);
    afterEach(() => rmSync(root, {recursive: true, force: true}));

    it('ignores CRLF normalization and returns the same hash', () => {
        const original = sourceHash(root);
        writeSource('export {};\r\n');
        expect(sourceHash(root)).toBe(original);
    });

    it('detects a changed source file', () => {
        const original = sourceHash(root);
        writeSource('changed\n');
        expect(sourceHash(root)).not.toBe(original);
    });

    it('writes a fixture stamp from its CLI entry point', () => {
        const writer = fileURLToPath(new URL(
            '../../../../scripts/tools/buildInfo/writeBuildInfo.mjs', import.meta.url,
        ));
        const result = spawnSync(process.execPath, [writer, root], {encoding: 'utf8'});
        expect(result.status).toBe(0);
        const first = readFileSync(join(root, 'dist/build-info.json'), 'utf8');
        const info = JSON.parse(first);
        expect(info).toMatchObject({
            name: 'fixture', version: '1.0.0', sourceHash: sourceHash(root), dirty: expect.any(Boolean),
        });
        expect(info.commit === undefined || info.commit.length === 40).toBe(true);
        spawnSync(process.execPath, [writer, root], {encoding: 'utf8'});
        expect(readFileSync(join(root, 'dist/build-info.json'), 'utf8')).toBe(first);
        expect(run().status).toBe(0);
    });

    it('keeps hashes stable across repeated calls', () => {
        expect(sourceHash(root)).toBe(sourceHash(root));
    });

    it('accepts a fresh stamp', () => {
        stamp();
        expect(run().status).toBe(0);
    });

    it('rejects a stale stamp with the required message', () => {
        stamp();
        writeSource('changed\n');
        const result = run();
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe('dist is stale (sources changed since the last build): run npm run build');
    });

    it('reports a missing stamp', () => {
        const result = run();
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe('no build stamp: dist was not built here');
    });
});
