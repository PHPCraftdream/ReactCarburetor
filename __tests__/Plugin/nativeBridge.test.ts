import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";
import {offsetAt} from "@plugin/Utils/Native/offsetAt.mts";
import {runNativeOnce} from "@plugin/Utils/Native/nativeBridge.mts";
import {platformPackageNames} from "@plugin/Utils/Native/platformPackage.mts";
import {resolveBinary} from "@plugin/Utils/Native/resolveBinary.mts";

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

/** `carburetor-lint-<pid>-<digest>.json`, the marker `runNativeOnce` leaves after it runs. */
const bridgeResultFiles = (): string[] =>
    readdirSync(os.tmpdir()).filter((name) => name.startsWith('carburetor-lint-') && name.endsWith('.json'));

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

    /** The result file the bridge would use for `cwd`, computed exactly as runPaths does. */
    const resultPath = (cwd: string): string => {
        const digest = Buffer.from(cwd).toString('base64url').slice(0, 24);

        return path.join(os.tmpdir(), `carburetor-lint-${process.pid}-${digest}.json`);
    };

    test('with no binary anywhere, the run throws instead of reporting zero problems', () => {
        const cwd = stage();

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
            expect(JSON.parse(readFileSync(resultPath(cwd), 'utf8'))).toHaveProperty('error');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a worker reading a runner\'s failure marker throws it instead of waiting out the clock', () => {
        const cwd = stage();
        const result = resultPath(cwd);
        const lock = result.replace(/\.json$/, '.lock');

        // The lock exists means this process is a waiter, not the runner; the marker is what a
        // failed runner leaves behind.
        writeFileSync(lock, '');
        writeFileSync(result, JSON.stringify({error: 'the staged failure'}));

        try {
            expect(() => runNativeOnce(cwd, () => undefined)).toThrow(/the staged failure/);
        } finally {
            rmSync(lock, {force: true});
            rmSync(result, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('the bridge, through the real host', () => {
    test('the native binary runs exactly once for 6 files and 24 rules', () => {
        const {pid} = runOxlint(path.join('plugin', '__fixtures__', 'oxlintrc.json'), CORPUS);
        const ownResults = bridgeResultFiles().filter((name) => name.startsWith(`carburetor-lint-${pid}-`));

        // Exactly one result file under this run's own pid: one spawn, however many (rule, file)
        // pairs asked for it. Filtering by pid, rather than by "new since before", is what keeps
        // this assertion honest when other test files spawn real oxlint processes concurrently.
        expect(ownResults.length).toBe(1);
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
