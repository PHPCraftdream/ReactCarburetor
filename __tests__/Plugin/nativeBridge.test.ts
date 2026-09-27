import {spawn, spawnSync} from "node:child_process";
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";
import {offsetAt} from "@plugin/Utils/Native/offsetAt.mts";
import {runNativeOnce} from "@plugin/Utils/Native/nativeBridge.mts";
import {platformPackageNames} from "@plugin/Utils/Native/platformPackage.mts";
import {resolveBinary} from "@plugin/Utils/Native/resolveBinary.mts";
import type {INativeDiagnostic} from "@plugin/Utils/Native/INativeDiagnostic.mts";

/**
 * The bridge end to end: the real host, the real binary, one process for the whole run.
 *
 * `runNativeOnce` and `nativeRule` are not unit-tested directly, because the interesting behaviour
 * — one spawn, correct path matching, a real `context.report` — only exists once oxlint is the one
 * calling them. A synthetic host or a hand-rolled context would test the mock, not the bridge. So
 * this suite runs the actual `oxlint` binary against the actual fixture corpus, the way a consumer
 * would, and inspects the one side effect that reveals how many times the native binary ran: the
 * result file `runNativeOnce` writes in the OS temp directory, one per spawn.
 */
const ROOT: string = process.cwd();
const CORPUS: readonly string[] = [
    path.join('plugin', '__fixtures__', 'data', 'reads.tsx'),
    path.join('plugin', '__fixtures__', 'data', 'writes.tsx'),
    path.join('plugin', '__fixtures__', 'lifecycle', 'lifecycle.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'effects.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'boundaries.ts'),
    path.join('plugin', '__fixtures__', 'lifecycle', 'lifecycleClassProperty.tsx'),
];

/** Where the bridge keeps its own lock/result files, mirroring its private `BRIDGE_DIR`. */
const BRIDGE_DIR = path.join(os.tmpdir(), 'carburetor-lint');

mkdirSync(BRIDGE_DIR, {recursive: true});

/** This process's own start time, exactly as the bridge computes it — public Node APIs only. */
const processStartMs = (): number => Date.now() - Math.round(process.uptime() * 1000);

/** The lock path `runNativeOnce` would use for `cwd`, computed exactly as `runPaths` does. */
const lockPathFor = (cwd: string): string => {
    const digest = Buffer.from(cwd).toString('base64url').slice(0, 24);

    return path.join(BRIDGE_DIR, `${process.pid}-${digest}.lock`);
};

/** The result path a genuine runner would publish for an existing `lock`: the lock's own
 * filesystem identity, exactly as `resultPathFor` in the bridge derives it. */
const resultPathFor = (lock: string): string => {
    const stat = statSync(lock);

    return lock.replace(/\.lock$/, `.${stat.dev.toString(36)}${stat.ino.toString(36)}.json`);
};

/** Samples `dir` for every name that ever appears in it, so a positive ("this filename existed
 * at some point") is provable without racing a fixed delay. `dir` is a throwaway `TEMP` made for
 * one child (see below): this machine's real temp directory holds hundreds of thousands of
 * unrelated entries, and `readdirSync` over it is far too slow to catch a file that lives only a
 * few milliseconds — the isolated directory stays small, so polling it stays fast. */
const trackBridgeFiles = (dir: string): {stop: () => Promise<string[]>} => {
    const seen = new Set<string>();
    let polling = true;

    const sample = (): void => {
        try {
            for (const name of readdirSync(dir)) {
                seen.add(name);
            }
        } catch {
            // A rename mid-read can make one sample miss a beat; the next one catches it.
        }
    };

    const loop = (async (): Promise<void> => {
        while (polling) {
            sample();
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
    })();

    return {
        stop: async (): Promise<string[]> => {
            polling = false;
            await loop;
            sample();

            return [...seen];
        },
    };
};

interface IOxlintRun {
    output: string;
    /** The spawned oxlint process's own OS pid — the same value it sees as its own `process.pid`,
     * which the bridge keys its lock/result files by. Other test files run real oxlint processes
     * too, so counting "any new result file" would race against them; counting by this exact pid
     * does not, whatever else is running at the same time. */
    pid: number;
}

const runOxlint = (config: string, files: readonly string[]): IOxlintRun => {
    const result = spawnSync(
        process.execPath,
        [path.join('node_modules', 'oxlint', 'bin', 'oxlint'), '-c', config, ...files],
        {cwd: ROOT, encoding: 'utf8'},
    );

    return {output: result.stdout || '', pid: result.pid};
};

describe('offsetAt', () => {
    test('the first character of the first line is offset 0', () => {
        expect(offsetAt('abc\ndef\n', 1, 1)).toBe(0);
    });

    test('a later line accounts for every newline before it', () => {
        expect(offsetAt('abc\ndef\n', 2, 1)).toBe(4);
    });

    test('a column past the first character of a line', () => {
        expect(offsetAt('abc\ndef\n', 2, 3)).toBe(6);
    });
});

describe('resolveBinary', () => {
    test('finds the workspace build this repository just produced', () => {
        const binary = resolveBinary();

        expect(binary).toBeDefined();
        expect(existsSync(binary as string)).toBe(true);
    });

    test('CARBURETOR_LINT_BIN overrides everything else, when it points at a real file', () => {
        const override = path.join(ROOT, 'package.json');

        process.env.CARBURETOR_LINT_BIN = override;

        try {
            expect(resolveBinary()).toBe(override);
        } finally {
            delete process.env.CARBURETOR_LINT_BIN;
        }
    });
});

describe('platformPackageNames', () => {
    test('the first candidate is the package npm installs on this machine', () => {
        // The -gnu suffix assumes Node's process.report is enabled and names glibc, which is
        // true everywhere this suite runs; a musl machine flipping the order is exactly the
        // kind of environment drift this assertion exists to surface.
        const expected = `carburetor-lint-${process.platform}-${process.arch}` +
            (process.platform === 'linux' ? '-gnu' : '');

        expect(platformPackageNames()[0]).toBe(expected);
    });

    test('single-binary platforms name exactly one package, whatever the machine', () => {
        expect(platformPackageNames('darwin', 'arm64')).toEqual(['carburetor-lint-darwin-arm64']);
        expect(platformPackageNames('sunos', 'x64')).toEqual(['carburetor-lint-sunos-x64']);
    });

    test('linux offers both libc builds, arm64 included', () => {
        const names = platformPackageNames('linux', 'arm64');

        expect(names).toContain('carburetor-lint-linux-arm64-gnu');
        expect(names).toContain('carburetor-lint-linux-arm64-musl');
    });
});

describe('a missing binary fails loudly', () => {
    // An empty directory stands in for a consumer project whose optionalDependencies did not
    // deliver a binary, and the injected resolver stands in for the whole lookup having missed.
    const stage = (): string => mkdtempSync(path.join(os.tmpdir(), 'carburetor-lint-missing-'));

    test('with no binary anywhere, the run throws instead of reporting zero problems', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);

        try {
            let failure: unknown;

            try {
                runNativeOnce(cwd, () => undefined);
            } catch (error) {
                failure = error;
            }

            expect(failure).toBeInstanceOf(Error);
            expect((failure as Error).message).toContain('no native binary for this platform');
            expect((failure as Error).message).toContain('npm install --save-dev carburetor-lint');
            expect((failure as Error).message).toContain(platformPackageNames()[0]);

            // The failure is written where the other workers of a multithreaded host are
            // waiting for it, so they inherit this throw instead of a silent clean result.
            expect(JSON.parse(readFileSync(resultPathFor(lock), 'utf8'))).toHaveProperty('error');
        } finally {
            rmSync(lock, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a worker reading a runner\'s failure marker throws it instead of waiting out the clock', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);

        // The lock exists means this process is a waiter, not the runner; the marker is what a
        // failed runner leaves behind.
        writeFileSync(lock, '');

        const result = resultPathFor(lock);

        writeFileSync(result, JSON.stringify({error: 'the staged failure'}));

        try {
            expect(() => runNativeOnce(cwd, () => undefined)).toThrow(/the staged failure/);
        } finally {
            rmSync(lock, {force: true});
            rmSync(result, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a lock older than this process\'s own start is reclaimed instead of waited on', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);

        writeFileSync(lock, '');

        // Predates this process, so it can only be a dead process's — never a live sibling thread's.
        const foreign = new Date(processStartMs() - 10_000);

        utimesSync(lock, foreign, foreign);

        try {
            let failure: unknown;

            try {
                runNativeOnce(cwd, () => undefined);
            } catch (error) {
                failure = error;
            }

            // The runner's own failure message, not the waiter's timeout message: proof this
            // thread reclaimed the stale lock and ran, rather than waiting on a dead owner.
            expect(failure).toBeInstanceOf(Error);
            expect((failure as Error).message).toContain('no native binary for this platform');
        } finally {
            rmSync(lock, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    // The next two tests are the only ones in this file where `runNativeOnce` succeeds instead
    // of throwing, which latches its module-level `cached` for the rest of this worker's tests —
    // by design, one process runs the binary once, ever. They run last so nothing after them
    // relies on that state still being empty.

    test('a stale result left at the old bare pid/cwd name is never mistaken for this run\'s answer', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);
        const staleBareResult = lock.replace(/\.lock$/, '.json');
        const stale: INativeDiagnostic[] = [
            {rule: 'stale-must-not-surface', file: 'x', line: 1, column: 1, message: 'x', severity: 'error'},
        ];

        // A leak from a run that used the pre-fix bare pid/cwd name, sitting there before this
        // run even starts — exactly what a reused pid would find if the naming carried no more
        // identity than that.
        writeFileSync(staleBareResult, JSON.stringify(stale));
        writeFileSync(lock, ''); // a concurrent runner has already claimed this run's lock

        const genuine: INativeDiagnostic[] = [
            {rule: 'genuine', file: 'x', line: 1, column: 1, message: 'y', severity: 'error'},
        ];
        const genuineResult = resultPathFor(lock);

        writeFileSync(genuineResult, JSON.stringify(genuine));

        try {
            expect(runNativeOnce(cwd, () => undefined)).toEqual(genuine);
        } finally {
            rmSync(lock, {force: true});
            rmSync(staleBareResult, {force: true});
            rmSync(genuineResult, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a write-in-progress artifact at the atomic-write temp name is never parsed as the answer', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);

        writeFileSync(lock, '');

        const result = resultPathFor(lock);
        const tmp = `${result}.${process.pid}-staged.tmp`;
        const genuine: INativeDiagnostic[] = [
            {rule: 'genuine', file: 'x', line: 1, column: 1, message: 'y', severity: 'error'},
        ];

        // What a torn write would leave mid-flight: garbage, and under a name a reader never
        // looks at, since only the exact final name is ever polled.
        writeFileSync(tmp, '{"incomplete');
        writeFileSync(result, JSON.stringify(genuine));

        try {
            expect(runNativeOnce(cwd, () => undefined)).toEqual(genuine);
        } finally {
            rmSync(lock, {force: true});
            rmSync(result, {force: true});
            rmSync(tmp, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a lock created during this process is never reclaimed, however old it looks', () => {
        const cwd = stage();
        const lock = lockPathFor(cwd);

        writeFileSync(lock, '');

        // Looks stale by a duration heuristic, but postdates this process's own start — a live
        // sibling thread's lock, not a dead process's.
        const withinProcess = new Date(processStartMs() + 1);

        utimesSync(lock, withinProcess, withinProcess);

        const genuine: INativeDiagnostic[] = [
            {rule: 'genuine', file: 'x', line: 1, column: 1, message: 'y', severity: 'error'},
        ];
        const genuineResult = resultPathFor(lock);

        writeFileSync(genuineResult, JSON.stringify(genuine));

        try {
            // A second election attempt here would spawn a duplicate runner; getting the
            // genuine, already-published result back instead proves the lock was not reclaimed.
            expect(runNativeOnce(cwd, () => undefined)).toEqual(genuine);
        } finally {
            rmSync(lock, {force: true});
            rmSync(genuineResult, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('the bridge, through the real host', () => {
    test('the native binary runs exactly once for 6 files and 24 rules, and cleans up after itself', async () => {
        const config = path.join('plugin', '__fixtures__', 'oxlintrc.json');
        // A private TEMP for this one child: `os.tmpdir()` is the bridge's own namespace, so
        // pointing the child at an empty directory isolates its lock/result files completely,
        // both from this machine's own (unrelated) temp-directory clutter and from any other
        // process that happens to be linting at the same time.
        const isolatedTemp = mkdtempSync(path.join(os.tmpdir(), 'carburetor-lint-isolated-'));
        // The child's own BRIDGE_DIR lives one level under its `os.tmpdir()`.
        const isolatedBridgeDir = path.join(isolatedTemp, 'carburetor-lint');

        try {
            const child = spawn(
                process.execPath,
                [path.join('node_modules', 'oxlint', 'bin', 'oxlint'), '-c', config, ...CORPUS],
                {cwd: ROOT, stdio: 'ignore', env: {...process.env, TEMP: isolatedTemp, TMP: isolatedTemp}},
            );
            const tracker = trackBridgeFiles(isolatedBridgeDir);

            await new Promise<void>((resolve) => child.once('close', () => resolve()));

            const seen = await tracker.stop();
            const resultsSeen = seen.filter((name) => name.endsWith('.json'));

            // Exactly one runner election, exactly one result file, for this exact process.
            expect(resultsSeen.length).toBe(1);

            // The process has fully exited by now, so its own exit-time cleanup has already run.
            expect(readdirSync(isolatedBridgeDir)).toEqual([]);
        } finally {
            rmSync(isolatedTemp, {recursive: true, force: true});
        }
    });

    test('every rule reports through the real host at the right place', () => {
        const {output} = runOxlint(path.join('plugin', '__fixtures__', 'oxlintrc.json'), CORPUS);

        expect(output).toContain('reads.tsx:15:25');
        expect(output).toContain('carburetor(no-use-carburetor-outside-render)');
        expect(output).toContain('writes.tsx:16:9');
        expect(output).toContain('carburetor(no-direct-data-write)');
        expect(output).toContain('boundaries.ts:24:34');
        expect(output).toContain('carburetor(no-module-level-store)');
    });

    test('a rule the config leaves off never asks the bridge to report it', () => {
        const config = path.join('plugin', '__fixtures__', 'oxlintrc.json');
        const reads = path.join('plugin', '__fixtures__', 'data', 'reads.tsx');
        const full = runOxlint(config, [reads]);

        expect(full.output).toContain('no-get-data-in-render');

        // A throwaway config enabling only one of the five reads.tsx violations: the bridge still
        // runs (another rule needs it), but this rule's own create() was never called, so its
        // finding is invisible however wide the native scan was.
        const narrow = runOxlint(
            path.join('__tests__', 'Plugin', 'fixtures', 'onlyEscaping.oxlintrc.json'),
            [reads],
        );

        expect(narrow.output).not.toContain('no-get-data-in-render');
        expect(narrow.output).toContain('no-escaping-tracked-data');
    });
});
