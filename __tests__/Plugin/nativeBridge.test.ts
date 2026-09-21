import {spawnSync} from "node:child_process";
import {existsSync, readdirSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";
import {offsetAt} from "@plugin/Utils/Native/offsetAt.mts";
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
    'reads.tsx',
    'writes.tsx',
    'lifecycle.tsx',
    'effects.tsx',
    'boundaries.ts',
    'lifecycleClassProperty.tsx',
].map((name) => path.join('plugin', '__fixtures__', name));

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

describe('the bridge, through the real host', () => {
    test('the native binary runs exactly once for 6 files and 22 rules', () => {
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
        const full = runOxlint(config, [path.join('plugin', '__fixtures__', 'reads.tsx')]);

        expect(full.output).toContain('no-get-data-in-render');

        // A throwaway config enabling only one of the five reads.tsx violations: the bridge still
        // runs (another rule needs it), but this rule's own create() was never called, so its
        // finding is invisible however wide the native scan was.
        const narrow = runOxlint(
            path.join('__tests__', 'Plugin', 'fixtures', 'onlyEscaping.oxlintrc.json'),
            [path.join('plugin', '__fixtures__', 'reads.tsx')],
        );

        expect(narrow.output).not.toContain('no-get-data-in-render');
        expect(narrow.output).toContain('no-escaping-tracked-data');
    });
});
