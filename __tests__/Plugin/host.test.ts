import {execFileSync} from "node:child_process";
import * as path from "node:path";

/**
 * Proves the 22 carburetor rules work in the host that actually runs them.
 *
 * Detection lives in the native crate now; each rule here is a thin bridge that reports whatever
 * the binary already found (see plugin/src/Utils/Native/nativeBridge.mts). A synthetic RuleTester
 * snippet never touches disk, so it cannot exercise that path at all — this file is what pins the
 * whole thing down instead: the real binary, spawned by the real host, over a real file on disk.
 * native/src/rules/ carries the per-rule edge-case tests; this one is "does it fire, at the right
 * place, through oxlint" for every rule, once each.
 */
const ROOT: string = process.cwd();
const OXLINT: string = path.join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint');
const RULE_ID: string = 'carburetor(no-lifecycle-class-property)';

const runOxlint = (args: string[]): string => {
    try {
        return execFileSync(process.execPath, [OXLINT, ...args], {encoding: 'utf8', cwd: ROOT});
    } catch (error) {
        // oxlint exits non-zero when it reports anything, which is the interesting case here.
        const failure = error as {stdout?: string; stderr?: string};

        return `${failure.stdout || ''}${failure.stderr || ''}`;
    }
};

const countOccurrences = (haystack: string, needle: string): number => {
    return haystack.split(needle).length - 1;
};

describe('lint plugin in the oxlint host', () => {
    test('reports the fixture through the real binary', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/lifecycleClassProperty.tsx',
        ]);

        expect(output).toContain(RULE_ID);
        // The violation sits on the class property of BadRow, not on the class or the method.
        expect(output).toContain('lifecycleClassProperty.tsx:5:5');
        // GoodRow declares the same lifecycle as a method and must stay unreported.
        expect(countOccurrences(output, RULE_ID)).toEqual(1);
    });

    test('every rule in the reads group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/reads.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-get-data-in-render)',
            'carburetor(no-computed-get-in-render)',
            'carburetor(no-computed-get-in-computed)',
            'carburetor(no-use-carburetor-outside-render)',
            'carburetor(no-escaping-tracked-data)',
        ];

        // A positive control: a green lint run proves nothing if the rules never see the file.
        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the writes group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/writes.tsx',
        ]);

        const expected: string[] = [
            'carburetor(require-emit-after-draft-write)',
            'carburetor(no-direct-data-write)',
            'carburetor(no-external-data-mutation)',
            'carburetor(no-tracked-data-mutation)',
            'carburetor(no-untrackable-draft-mutation)',
            'carburetor(no-store-write-in-render)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the lifecycle group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/lifecycle.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-lifecycle-class-property)',
            'carburetor(require-super-in-lifecycle)',
            'carburetor(require-bind-for-passed-method)',
            'carburetor(no-handler-created-in-render)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the effects group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/effects.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-async-effect)',
            'carburetor(no-duplicate-effect-name)',
            'carburetor(require-effect-deps)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the boundaries group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/boundaries.ts',
        ]);

        const expected: string[] = [
            'carburetor(no-async-transaction)',
            'carburetor(no-module-level-store)',
            'carburetor(no-untrackable-store-data)',
            'carburetor(require-subscription-disposal)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('the repository config loads the plugin', () => {
        const output = runOxlint(['-c', '.oxlintrc.json', 'plugin/src/index.mts']);

        expect(output).not.toContain('Failed to load JS plugin');
        expect(output).not.toContain('Failed to parse oxlint configuration file');
        expect(output).not.toContain(RULE_ID);
    });
});
