/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Throughput scaling of the functional-class rules: a generated project with `count` Function
// classes in one stylesheet and `count` elements across TSX files, at 2k and 8k. Every fourth
// Function applies a Brick (valid-function-class) and every second element carries a Tone
// (require-function-class), so the exact counts prove the CSS index, the CSS rules and the markup
// rule all ran; the 8k/2k time ratio is the guard against a quadratic index or lookup.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {emit} from '../../harness/lib.mjs';

const [count] = process.argv.slice(2).map(Number);

const name = process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint';
const binary = process.env.CARBURETOR_LINT_BIN
    ?? join(process.cwd(), 'native', 'target', 'release', name);

const PER_FILE = 100;

let css = `:root { --palette-blue-600: #2563eb; --palette-white: #fff; }
@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-blue-600);
  --color-accent-on-fill: var(--palette-white);
}
@utility tone-accent-solid { @apply bg-accent-fill text-accent-on-fill; }
@utility shape-control { @apply h-10 px-4 rounded-md; }
@utility type-label { @apply text-sm font-medium; }
@utility pattern-button { @apply shape-control type-label; }
@layer components {
`;
for (let index = 0; index < count; index++) {
    const brick = index % 4 === 0 ? ' px-1' : '';
    css += `  .item${index}-button { @apply pattern-button tone-accent-solid${brick}; }\n`;
}
css += '}\n';

const dir = mkdtempSync(join(tmpdir(), 'lint-classes-gate-'));
mkdirSync(join(dir, 'src', 'styles'), {recursive: true});
writeFileSync(join(dir, '.carburetorrc.json'), JSON.stringify({classes: {css: ['src/**/*.css']}}));
writeFileSync(join(dir, 'src', 'styles', 'app.css'), css);

for (let file = 0; file * PER_FILE < count; file++) {
    let source = `export const View${file} = () => (\n    <div>\n`;
    for (let index = file * PER_FILE; index < Math.min(count, (file + 1) * PER_FILE); index++) {
        const className = index % 2 === 0 ? 'tone-accent-solid' : `item${index}-button`;
        source += `        <button className="${className}">x</button>\n`;
    }
    source += '    </div>\n);\n';
    writeFileSync(join(dir, 'src', `View${file}.tsx`), source);
}

const started = performance.now();
const result = spawnSync(binary, ['--format=json', 'src'], {cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const lintMs = performance.now() - started;

let markup = -1;
let functions = -1;
if (result.status === 1) {
    try {
        const findings = JSON.parse(result.stdout);
        markup = findings.filter(item => item.rule === 'carburetor/require-function-class').length;
        functions = findings.filter(item => item.rule === 'carburetor/valid-function-class').length;
    } catch {
        markup = -1;
    }
}

rmSync(dir, {recursive: true, force: true});

const expectedMarkup = Math.ceil(count / 2);
const expectedFunctions = Math.ceil(count / 4);
emit({lintMs, markup, functions, done: markup === expectedMarkup && functions === expectedFunctions});
