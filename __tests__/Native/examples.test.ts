import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';

const root = process.cwd();
const binary = resolve(root, 'native/target/release/carburetor-lint');
const executable = process.platform === 'win32' ? `${binary}.exe` : binary;
const examples = resolve(root, 'examples');
if (!existsSync(executable)) throw new Error(`Native examples require built binary: ${executable}`);
const sourceFiles = (directory: string): string[] => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
});
const run = (files: string[]) => {
    const result = spawnSync(executable, [
        '--format=json', ...files.map(file => relative(root, file).replaceAll('\\', '/')),
    ], {cwd: root, encoding: 'utf8'});
    if (result.error) throw new Error(`lint process failed: ${result.error.message}`);
    if (result.signal) throw new Error(`lint process failed: terminated by signal ${result.signal}`);
    return {result, stdout: result.stdout ?? ''};
};
const parseRun = (runResult: ReturnType<typeof run>) => {
    if (!runResult.stdout.trim()) {
        throw new Error(`lint process failed: empty stdout (status ${runResult.result.status})`);
    }
    return parse(runResult.stdout);
};
const parse = (output: string) => {
    if (!output.trim()) throw new Error('parse: empty lint output');
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) throw new Error(`parse: expected JSON array, got: ${output.slice(0, 80)}`);
    return parsed;
};
// A file named `Name.expected.<rule>[.x<N>].<rule2>.tsx` declares every finding its hazard
// triggers: each rule once, or N times with `.x<N>` (documented overlaps, e.g. a clean `update`
// callback is both H30 and H32 territory); every other file in `examples/wrong/<rule-id>/`
// expects exactly one finding of `carburetor/<rule-id>`.
const expectedRules = (file: string): string[] | null => {
    const name = file.split(sep).at(-1) ?? '';
    const match = /^.+\.(?:expected)\.([a-z-]+(?:\.(?:[a-z-]+|x\d+))*)\.(?:tsx?|jsx?)$/.exec(name);
    if (!match) return null;
    const rules: string[] = [];
    for (const token of match[1].split('.')) {
        const times = /^x(\d+)$/.exec(token);
        if (times) rules.push(...Array.from({length: Number(times[1]) - 1}, () => rules[rules.length - 1]));
        else rules.push(token);
    }
    return rules;
};

// Multiset-exact: each expected-rule occurrence consumes exactly one finding; extras,
// duplicates without a matching expectation, and missing rules all fail.
const findingsMatchExpected = (findings: Array<{rule: string}>, expected: string[]): boolean => {
    const remaining = [...expected];
    for (const finding of findings) {
        const index = remaining.indexOf(finding.rule);
        if (index === -1) return false;
        remaining.splice(index, 1);
    }
    return remaining.length === 0;
};

describe('native lint on documentation examples', () => {
    test('binary crashes and non-JSON output are reported as failures', () => {
        expect(() => parse('')).toThrow();
        expect(() => parse('not json')).toThrow();
        expect(() => parse('{"a":1}')).toThrow();
    });

    test('a duplicate finding for an expected rule fails the multiset check', () => {
        expect(findingsMatchExpected([{rule: 'a'}, {rule: 'a'}, {rule: 'b'}], ['a', 'b'])).toBe(false);
        expect(findingsMatchExpected([{rule: 'a'}, {rule: 'b'}], ['a', 'b'])).toBe(true);
        expect(findingsMatchExpected([], ['a'])).toBe(false);
        expect(findingsMatchExpected([{rule: 'a'}], ['a'])).toBe(true);
    });

    test('proper examples are clean under native defaults', () => {
        const files = sourceFiles(examples).filter(file => relative(examples, file).split(sep)[0] !== 'wrong');
        expect(files.length).toBeGreaterThan(0);
        const {result, stdout} = run(files);
        expect(result.status).toBe(0);
        // A proper example teaches the right pattern: no finding of any severity, warnings included.
        expect(parseRun({result, stdout})).toEqual([]);
    });

    test('each wrong example has exactly its expected finding', () => {
        const wrongRoot = resolve(examples, 'wrong');
        const directories = readdirSync(wrongRoot, {withFileTypes: true}).filter(entry => entry.isDirectory());
        expect(directories.length).toBeGreaterThan(0);
        for (const directory of directories) {
            // `_`-prefixed directories hold hazards no native rule catches (not implemented yet,
            // or a development diagnostic); their files must be silent and still typecheck.
            if (directory.name.startsWith('_')) {
                const files = sourceFiles(join(wrongRoot, directory.name));
                expect(files.length).toBeGreaterThan(0);
                const typecheck = spawnSync('npx', [
                    'tsc', '--noEmit', '-p', resolve(root, 'scripts/tools/tsconfig.examples-unlinted.json'),
                ], {cwd: root, encoding: 'utf8', shell: process.platform === 'win32'});
                expect(typecheck.stdout + typecheck.stderr).toBe('');
                expect(typecheck.status).toBe(0);
                for (const file of files) {
                    const {result, stdout} = run([file]);
                    expect(result.status).toBe(0);
                    expect(parseRun({result, stdout})).toEqual([]);
                }

                continue;
            }
            const expected = `carburetor/${directory.name}`;
            const files = sourceFiles(join(wrongRoot, directory.name));
            expect(files.length).toBeGreaterThan(0);
            for (const file of files) {
                const expectedSet = expectedRules(file);
                const runResult = run([file]);
                const findings = parseRun(runResult);
                const {result} = runResult;
                if (expectedSet === null) {
                    expect(findings).toHaveLength(1);
                    expect(findings[0].rule).toBe(expected);
                    expect(result.status).toBe(findings[0].severity === 'error' ? 1 : 0);
                } else {
                    expect(expectedSet).toContain(directory.name);
                    expect(findings.length).toBeGreaterThan(0);
                    expect(findings).toHaveLength(expectedSet.length);
                    const hasError = findings.some((finding: {severity: string}) => finding.severity === 'error');
                    expect(result.status).toBe(hasError ? 1 : 0);
                    expect(findingsMatchExpected(
                        findings,
                        expectedSet.map(rule => `carburetor/${rule}`),
                    )).toBe(true);
                    expect([...new Set<string>(findings.map((finding: {rule: string}) => finding.rule))]
                        .sort((a, b) => a.localeCompare(b)))
                        .toEqual([...new Set<string>(expectedSet)]
                            .map(rule => `carburetor/${rule}`).sort((a, b) => a.localeCompare(b)));
                }
            }
        }
    });
});
