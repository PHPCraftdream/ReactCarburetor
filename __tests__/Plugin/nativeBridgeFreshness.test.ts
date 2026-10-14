import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";
import {runNativeOnce} from "@plugin/Utils/Native/nativeBridge.mts";

type TNativeSpawn = typeof spawnSync;

const nativeSpawn = rstest.hoisted(() => rstest.fn<TNativeSpawn>());

rstest.mock('node:child_process', () => ({spawnSync: nativeSpawn}));

/** The stub reports the file's current content as the one finding, so a stale answer is visible. */
const stubNative = (): void => {
    nativeSpawn.mockImplementation((...args: Parameters<TNativeSpawn>) => {
        const {cwd} = args[2] as {cwd: string};
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
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});
