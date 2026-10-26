import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extractTarball} from '../../../scripts/tools/release/ci/extractTarball.mjs';
import {smokePacked} from '../../../scripts/tools/release/ci/smokePacked.mjs';
import {verifyGating} from '../../../scripts/tools/release/ci/verifyGating.mjs';
import {verifyPublished} from '../../../scripts/tools/release/ci/verifyPublished.mjs';

const ROOT = process.cwd();

describe('extractTarball', () => {
    let directory = '';

    beforeEach(() => {
        directory = mkdtempSync(path.join(os.tmpdir(), 'extract-'));
    });

    afterEach(() => {
        rmSync(directory, {recursive: true, force: true});
    });

    test('unpacks an npm tarball without its package/ directory and keeps the execute bit', async () => {
        const source = path.join(directory, 'source');
        const deep = path.join('deep', 'x'.repeat(60), 'y'.repeat(60));

        mkdirSync(path.join(source, 'bin'), {recursive: true});
        mkdirSync(path.join(source, deep), {recursive: true});
        const manifest = {name: 'extract-probe', version: '1.0.0', files: ['bin', 'deep']};

        writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
        writeFileSync(path.join(source, 'bin', 'run'), '#!/bin/sh\necho hi\n');
        chmodSync(path.join(source, 'bin', 'run'), 0o755);
        writeFileSync(path.join(source, deep, 'file.txt'), 'deep contents');
        execFileSync('npm', ['pack', '--pack-destination', directory], {
            cwd: source, stdio: 'ignore', shell: process.platform === 'win32',
        });

        const target = path.join(directory, 'target');
        const written = await extractTarball(path.join(directory, 'extract-probe-1.0.0.tgz'), target);

        const expected = [`${deep.split(path.sep).join('/')}/file.txt`, 'bin/run', 'package.json'];

        expect(written.sort((a: string, b: string) => a.localeCompare(b)))
            .toEqual(expected.sort((a: string, b: string) => a.localeCompare(b)));
        expect(readFileSync(path.join(target, 'bin', 'run'), 'utf8')).toEqual('#!/bin/sh\necho hi\n');
        expect(readFileSync(path.join(target, deep, 'file.txt'), 'utf8')).toEqual('deep contents');

        if (process.platform !== 'win32') {
            expect(statSync(path.join(target, 'bin', 'run')).mode & 0o111).not.toEqual(0);
        }
    });

    test('rejects a tarball that is not gzip', async () => {
        const file = path.join(directory, 'broken.tgz');

        writeFileSync(file, 'not a tarball');

        await expect(extractTarball(file, path.join(directory, 'target'))).rejects.toThrow();
    });
});

describe('smokePacked', () => {
    test('needs the launcher, the platform package and the fixture', async () => {
        await expect(smokePacked([])).rejects.toThrow('Usage');
        await expect(smokePacked(['--launcher', 'a', '--package', 'b'])).rejects.toThrow('Usage');
        await expect(smokePacked(['--launcher', 'a', '--bogus', 'b', '--fixture', 'c'])).rejects.toThrow('Usage');
    });

    test('fails clearly when the package directory holds no tarball', async () => {
        const directory = path.join(ROOT, 'npm', 'carburetor-lint-linux-x64-gnu');

        expect(existsSync(path.join(directory, 'package.json'))).toBe(true);
        await expect(smokePacked(['--launcher', 'npm/carburetor-lint', '--package', directory, '--fixture', 'x']))
            .rejects.toThrow('No packed tarball');
    });
});

describe('verifyGating', () => {
    test('needs the launcher, the offered packages and the package it expects', () => {
        expect(() => verifyGating([])).toThrow('Usage');
        expect(() => verifyGating(['--launcher', 'a', '--packages', 'b'])).toThrow('Usage');
        expect(() => verifyGating(['--launcher', 'a', '--packages', 'b', '--expect', 'c', '--bogus'])).toThrow('Usage');
    });

    test('refuses an expectation that is not among the offered packages', () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'gating-'));

        try {
            writeFileSync(path.join(directory, 'carburetor-lint-linux-x64-gnu-0.1.0.tgz'), '');

            expect(() => verifyGating(['--launcher', 'launcher.tgz', '--packages', directory,
                '--expect', 'carburetor-lint-w32-x64'])).toThrow('is not among the offered packages');
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });
});

describe('verifyPublished', () => {
    test('needs a plain version and a fixture', async () => {
        await expect(verifyPublished([])).rejects.toThrow('Usage');
        await expect(verifyPublished(['--version', 'latest', '--fixture', 'x'])).rejects.toThrow('Usage');
        await expect(verifyPublished(['--version', '0.1.0'])).rejects.toThrow('Usage');
    });
});

describe('the Node floor probe', () => {
    const probe = readFileSync(path.join(ROOT, 'scripts/tools/release/ci/floorProbe/probe.cjs'), 'utf8');

    test('covers the four builds the package ships', () => {
        for (const flavor of ['require-development', 'require-production', 'import-development', 'import-production']) {
            expect(probe).toContain(flavor);
        }
    });

    test('is exercised on the declared engines floor and above it', () => {
        const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
        const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {engines: {node: string}};
        const floor = manifest.engines.node.replace('>=', '');

        expect(floor).toEqual('24.0.0');
        expect(ci).toContain(`node: ['${floor}', '24', 'latest']`);
    });
});
