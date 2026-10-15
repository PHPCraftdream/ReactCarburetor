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
            const expected = `carburetor/${directory.name}`;
            const files = sourceFiles(join(wrongRoot, directory.name));
            expect(files.length).toBeGreaterThan(0);
            for (const file of files) {
                const result = run([file]);
                const findings = parse(result.stdout);
                expect(findings).toHaveLength(1);
                expect(findings[0].rule).toBe(expected);
                expect(result.status).toBe(findings[0].severity === 'error' ? 1 : 0);
            }
        }
    });
});
