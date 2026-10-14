import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";
import {runNativeOnce} from "@plugin/Utils/Native/nativeBridge.mts";

type TNativeSpawn = typeof spawnSync;

const nativeSpawn = rstest.hoisted(() => rstest.fn<TNativeSpawn>());

rstest.mock('node:child_process', () => ({spawnSync: nativeSpawn}));

/** The stub reports the file's current content as the one finding, so a stale answer is visible. */
const stubNative = (failing: {on: boolean} = {on: false}): void => {
    nativeSpawn.mockImplementation((...args: Parameters<TNativeSpawn>) => {
        const {cwd} = args[2] as {cwd: string};

        if (failing.on) {
            return {stdout: '', stderr: 'boom', status: 2, error: undefined} as ReturnType<TNativeSpawn>;
        }

        const message = readFileSync(path.join(cwd, 'a.ts'), 'utf8');

        return {
            stdout: JSON.stringify([{rule: 'stub', file: './a.ts', line: 1, column: 1, message, severity: 'error'}]),
            stderr: '', status: 0, error: undefined,
        } as ReturnType<TNativeSpawn>;
    });
};

describe('native bridge freshness', () => {
    test('an unchanged file reuses the run, a file saved after it triggers one fresh scan', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-fresh-'));
        const file = path.join(cwd, 'a.ts');
        const past = new Date(Date.now() - 60_000);

        try {
            stubNative();
            writeFileSync(file, 'first');
            utimesSync(file, past, past);

            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('first');
            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('first');
            expect(nativeSpawn).toHaveBeenCalledTimes(1);

            writeFileSync(file, 'second');

            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('second');
            expect(nativeSpawn).toHaveBeenCalledTimes(2);

            utimesSync(file, past, past);

            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('second');
            expect(runNativeOnce(cwd, () => 'stub')[0].message).toBe('second');
            expect(nativeSpawn).toHaveBeenCalledTimes(2);

            // A save whose coarse mtime trails the scan start by a moment still counts as newer.
            writeFileSync(file, 'third');
            const trailing = new Date(Date.now() - 1_000);
            utimesSync(file, trailing, trailing);

            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('third');
            expect(nativeSpawn).toHaveBeenCalledTimes(3);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a failed re-scan is retried instead of leaving the stale answer looking fresh', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-fresh-'));
        const file = path.join(cwd, 'a.ts');
        const past = new Date(Date.now() - 60_000);
        const failing = {on: false};

        try {
            stubNative(failing);
            writeFileSync(file, 'first');
            utimesSync(file, past, past);
            runNativeOnce(cwd, () => 'stub', file);
            writeFileSync(file, 'second');
            failing.on = true;

            expect(() => runNativeOnce(cwd, () => 'stub', file)).toThrow();
            expect(() => runNativeOnce(cwd, () => 'stub', file)).toThrow();

            failing.on = false;

            expect(runNativeOnce(cwd, () => 'stub', file)[0].message).toBe('second');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('two projects sharing a long path prefix never read each other result', () => {
        const parent = mkdtempSync(path.join(os.tmpdir(), 'carburetor-fresh-'));
        const first = path.join(parent, 'project-one');
        const second = path.join(parent, 'project-two');

        try {
            stubNative();
            mkdirSync(first);
            mkdirSync(second);
            writeFileSync(path.join(first, 'a.ts'), 'one');
            writeFileSync(path.join(second, 'a.ts'), 'two');

            expect(runNativeOnce(first, () => 'stub')[0].message).toBe('one');
            expect(runNativeOnce(second, () => 'stub')[0].message).toBe('two');
        } finally {
            rmSync(parent, {recursive: true, force: true});
        }
    });
});
