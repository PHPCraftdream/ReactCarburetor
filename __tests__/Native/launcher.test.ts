import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {runInNewContext} from 'node:vm';
import {describe, expect, test} from '@rstest/core';

const LAUNCHER = path.join(process.cwd(), 'npm', 'carburetor-lint', 'bin', 'carburetor-lint.js');
const source = readFileSync(LAUNCHER, 'utf8');

interface IScenario {
    result: {error?: Error; signal?: string | null; status: number | null};
    stderr: string;
}

const runInVm = (scenario: IScenario): number => {
    let exitCode = -1;
    let stderr = '';
    const exitSentinel = {};
    const sandbox = {
        require: (name: string): unknown => {
            if (name === 'child_process') return {spawnSync: () => scenario.result};
            if (name === 'fs') return {existsSync: () => true};
            if (name === 'path') return path;
            throw new Error(`unexpected require ${name}`);
        },
        process: {
            platform: 'linux', arch: 'x64', env: {CARBURETOR_LINT_BIN: '/test/binary'},
            argv: ['node', LAUNCHER], stderr: {write: (text: string) => { stderr += text; }},
            exit: (code: number) => { exitCode = code; throw exitSentinel; },
        },
        __dirname: path.dirname(LAUNCHER),
    };
    try {
        runInNewContext(source, sandbox);
    } catch (error) {
        if (error !== exitSentinel) throw error;
    }
    expect(stderr).toContain(scenario.stderr);
    return exitCode;
};

describe('native launcher failures', () => {
    test('spawn errors exit 2 and include the error', () => {
        expect(runInVm({
            result: {error: new Error('ENOENT'), status: null},
            stderr: 'ENOENT',
        })).toBe(2);
    });

    test('signal termination exits 2 and mentions the signal', () => {
        expect(runInVm({
            result: {status: null, signal: 'SIGTERM'},
            stderr: 'SIGTERM',
        })).toBe(2);
    });

    test.each([0, 1, 2, 17])('forwards normal exit status %i', (code) => {
        expect(runInVm({result: {status: code}, stderr: ''})).toBe(code);
    });

    test('a real spawn failure from a directory override exits 2', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-launcher-'));
        try {
            const result = spawnSync(process.execPath, [LAUNCHER], {
                encoding: 'utf8', env: {...process.env, CARBURETOR_LINT_BIN: dir},
            });
            expect(result.status).toBe(2);
            expect(result.stderr).toContain('could not run');
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });
});
