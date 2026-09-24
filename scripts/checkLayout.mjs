import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

/**
 * Checks the structural rules CONTRIBUTING states, so they are enforced rather than remembered:
 *
 *   - at most seven entries per directory, files and subdirectories together;
 *   - at most 600 physical lines per code file;
 *   - one export per file, except type files — named `Models.*` or living in a `Models/` directory —
 *     and `index` barrels, which group types and re-exports respectively.
 *
 * All are about navigability, and all are easy to break by accident while adding a file. The
 * export count is counted syntactically — `export const`, `export class`, `export function`,
 * `export default`, `export type`, `export interface`, `export enum` at the start of a line — which
 * is enough for the conventions this repository actually follows.
 */
const ROOTS = [
    'lib/src', 'plugin/src', 'plugin/internal', 'plugin/__fixtures__',
    '__tests__', 'native/src', 'native/tests', 'scripts', 'benchmarks', 'npm',
];
const STANDALONE_CODE_FILES = [
    'rslib.config.ts', 'rstest.config.ts', 'lib/rsbuild.config.ts', 'plugin/lint.d.ts',
];
const EXPORT_ROOTS = new Set(['lib/src', 'plugin/src', 'plugin/internal', '__tests__']);
const MAX_ENTRIES = 7;
const MAX_LINES = 600;
const TYPE_FILES = /^Models\.(ts|mts)$/;
const BARREL_FILES = /^index\.(ts|tsx|mts)$/;
const TEST_SUPPORT_FILES = /^(support|fixtures|helpers)\.(ts|tsx|mts)$/;
const SOURCE_FILES = /\.(ts|tsx|mts)$/;
const CODE_FILES = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|rs)$/;
const EXPORT_LINE = /^export\s+(const|class|function|default|type|interface|enum|abstract)\b/;

const problems = [];

const checkLines = (file) => {
    const source = readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);

    if (lines > MAX_LINES) {
        const where = relative('.', file).split(sep).join('/');

        problems.push(`${where}: ${lines} lines, at most ${MAX_LINES} allowed`);
    }
};

const countExports = (file) => {
    const source = readFileSync(file, 'utf8');
    const names = new Set();

    source.split('\n').forEach((line) => {
        const match = EXPORT_LINE.exec(line);

        if (!match) {
            return;
        }

        // A declaration split over lines still starts on one; the name follows the keyword.
        const name = line.replace(/^export\s+(abstract\s+)?(const|class|function|type|interface|enum)\s+/, '')
            .replace(/^default\s+/, 'default ')
            .split(/[\s<(:={]/)[0];

        names.add(name || match[1]);
    });

    return names.size;
};

const walk = (directory, root) => {
    const entries = readdirSync(directory).filter((entry) => entry !== 'node_modules');

    if (entries.length > MAX_ENTRIES) {
        const where = relative('.', directory).split(sep).join('/');

        problems.push(`${where}: ${entries.length} entries, at most ${MAX_ENTRIES} allowed`);
    }

    entries.forEach((entry) => {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
            walk(full, root);

            return;
        }

        if (CODE_FILES.test(entry)) {
            checkLines(full);
        }

        if (!EXPORT_ROOTS.has(root)) {
            return;
        }

        const inTypeDirectory = relative('.', directory).split(sep).includes('Models');
        const inTests = relative('.', directory).split(sep)[0] === '__tests__';

        if (!SOURCE_FILES.test(entry) || TYPE_FILES.test(entry) || BARREL_FILES.test(entry)
            || inTypeDirectory || (inTests && TEST_SUPPORT_FILES.test(entry))) {
            return;
        }

        const exported = countExports(full);

        if (exported > 1) {
            problems.push(`${relative('.', full).split(sep).join('/')}: ${exported} exports, expected one`);
        }
    });
};

ROOTS.forEach((root) => walk(root, root));
STANDALONE_CODE_FILES.forEach(checkLines);

if (problems.length > 0) {
    console.error(`Layout check failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}

console.log(`Layout check passed: at most ${MAX_ENTRIES} entries per directory, `
    + `${MAX_LINES} lines per code file, one export per file.`);
