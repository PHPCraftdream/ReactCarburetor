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
const run = (files: string[]) => spawnSync(executable, [
    '--format=json', ...files.map(file => relative(root, file).replaceAll('\\', '/')),
], {cwd: root, encoding: 'utf8'});
const parse = (output: string) => JSON.parse(output || '[]');
// A file named `Name.expected.<rule>.<rule2>.tsx` declares the full set of rules its single
// hazard demonstrably triggers (documented overlaps, e.g. a clean `update` callback is both
// H30 and H32 territory); every other file in `examples/wrong/<rule-id>/` expects exactly one
// finding of `carburetor/<rule-id>`.
const expectedRules = (file: string): string[] | null => {
    const name = file.split(sep).at(-1) ?? '';
    const match = /^.+\.(?:expected)\.([a-z-]+(?:\.[a-z-]+)*)\.(?:tsx?|jsx?)$/.exec(name);
    return match ? match[1].split('.') : null;
};

describe('native lint on documentation examples', () => {
    test('proper examples are clean under native defaults', () => {
        const files = sourceFiles(examples).filter(file => relative(examples, file).split(sep)[0] !== 'wrong');
        expect(files.length).toBeGreaterThan(0);
        const result = run(files);
        // A proper example teaches the right pattern: no finding of any severity, warnings included.
        expect(parse(result.stdout)).toEqual([]);
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
                for (const file of files) {
                    const result = run([file]);
                    expect(parse(result.stdout)).toEqual([]);
                }

                continue;
            }
            const expected = `carburetor/${directory.name}`;
            const files = sourceFiles(join(wrongRoot, directory.name));
            expect(files.length).toBeGreaterThan(0);
            for (const file of files) {
                const expectedSet = expectedRules(file);
                const result = run([file]);
                const findings = parse(result.stdout);
                if (expectedSet === null) {
                    expect(findings).toHaveLength(1);
                    expect(findings[0].rule).toBe(expected);
                    expect(result.status).toBe(findings[0].severity === 'error' ? 1 : 0);
                } else {
                    expect(expectedSet).toContain(directory.name);
                    expect(findings.length).toBeGreaterThan(0);
                    expect([...new Set<string>(findings.map((finding: {rule: string}) => finding.rule))]
                        .sort((a, b) => a.localeCompare(b)))
                        .toEqual(expectedSet.map(rule => `carburetor/${rule}`).sort((a, b) => a.localeCompare(b)));
                }
            }
        }
    });
});
