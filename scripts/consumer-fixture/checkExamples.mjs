import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const marker = '<!-- example:compile -->';

/** Collect and typecheck marked examples from the selected Markdown files. */
export function checkExamples(options = {}) {
    const docsRoot = options.docsRoot ?? path.join(root, 'docs');
    const paths = options.paths ?? [
        path.join(options.readmeRoot ?? root, 'README.md'),
        ...discover(docsRoot, docsRoot),
    ];
    const blocks = [];
    const failures = [];
    for (const file of paths) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        let fence = null;
        for (let i = 0; i < lines.length; i++) {
            const fenceMatch = lines[i].match(/^\s*(`{3,}|~{3,})/);
            if (fence) {
                if (fenceMatch?.[1][0] === fence.char && fenceMatch[1].length >= fence.length
                    && /^\s*$/.test(lines[i].slice(fenceMatch[0].length))) {
                    fence = null;
                }
                continue;
            }
            if (fenceMatch) {
                fence = {char: fenceMatch[1][0], length: fenceMatch[1].length};
                continue;
            }
            if (lines[i].trim() !== marker) continue;
            const markerLine = i + 1;
            let start = i + 1;
            while (start < lines.length
                && !/^\s*(`{3,}|~{3,})/.test(lines[start])
                && lines[start].trim() !== marker) start++;
            if (start === lines.length || lines[start].trim() === marker) {
                failures.push(`${file}:${markerLine}:1: missing fenced example block`);
                continue;
            }
            const open = lines[start].match(/^\s*(`{3,}|~{3,})\s*(\S*)/);
            if (!['ts', 'tsx'].includes(open[2])) {
                failures.push(`${file}:${markerLine}:1: expected a ts or tsx fenced block`);
                fence = {char: open[1][0], length: open[1].length};
                i = start;
                continue;
            }
            let end = start + 1;
            while (end < lines.length
                && !new RegExp(`^\\s*${open[1][0]}{${open[1].length},}\\s*$`).test(lines[end])) end++;
            if (end === lines.length) {
                failures.push(`${file}:${markerLine}:1: unclosed ${open[2]} example block`);
                continue;
            }
            blocks.push({file, markerLine, firstCodeLine: start + 2, language: open[2],
                code: lines.slice(start + 1, end).join('\n')});
            i = end;
        }
    }
    if (options.extractOnly) return {blocks, failures};
    if (!blocks.length && !failures.length) return {status: 0, output: 'No marked TypeScript examples found.'};
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-examples-'));
    try {
        const files = blocks.map((block, index) => {
            const name = `example-${index}.${block.language}`;
            fs.writeFileSync(path.join(temp, name), `${block.code}\nexport {};\n`);
            return name;
        });
        const rel = (value) => path.relative(temp, path.join(root, value)).replaceAll('\\', '/');
        const nodeModules = rel('node_modules');
        fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({compilerOptions: {
            target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true,
            noEmit: true, skipLibCheck: true, esModuleInterop: true,
            lib: ['ES2020', 'ES2021.WeakRef', 'DOM'],
            types: [], typeRoots: [`${nodeModules}/@types`],
            paths: {'*': [`${nodeModules}/*`], '@types/*': [`${nodeModules}/@types/*`],
                'react-carburetor': [rel('lib/src/Carburetor/index.ts')],
                'react-carburetor/interop': [rel('lib/src/Interop/index.ts')],
                'react-carburetor/lint': [rel('plugin/lint.d.ts')],
                '@/*': [rel('lib/src') + '/*'],
                react: [`${nodeModules}/@types/react/index.d.ts`], 'react/*': [`${nodeModules}/@types/react/*`],
                'react-dom': [`${nodeModules}/@types/react-dom/index.d.ts`],
                'react-dom/*': [`${nodeModules}/@types/react-dom/*`]},
        }, files}, null, 2));
        const result = spawnSync(process.execPath,
            [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(temp, 'tsconfig.json'), '--pretty', 'false'],
            {cwd: temp, encoding: 'utf8'});
        const diagnostics = [...failures];
        for (const line of `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/).filter(Boolean)) {
            const match = line.match(/example-(\d+)\.(?:tsx?)(?:\((\d+),(\d+)\)|:(\d+):(\d+)):/);
            if (match) {
                const block = blocks[Number(match[1])];
                const codeLine = Number(match[2] ?? match[4]);
                const column = match[3] ?? match[5];
                diagnostics.push(`${block.file}:${block.firstCodeLine + codeLine - 1}:${column}`
                    + ` (marker line ${block.markerLine}): ${line.slice(line.indexOf('error TS'))}`);
            } else diagnostics.push(line);
        }
        if (result.error) diagnostics.push(`Unable to run TypeScript compiler: ${result.error.message}`);
        const status = result.status === 0 && !failures.length ? 0 : 1;
        if (!diagnostics.length) {
            diagnostics.push(`${blocks.length} marked TypeScript example${blocks.length === 1 ? '' : 's'} passed.`);
        }
        return {status, output: diagnostics.join('\n')};
    } finally {
        fs.rmSync(temp, {recursive: true, force: true});
    }
}

/**
 * Recursively discovers Markdown files, excluding review and checkpoint archives.
 *
 * @param directory Directory to scan.
 * @param docsRoot Root whose archives are excluded.
 */
function discover(directory, docsRoot) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return directory === docsRoot && ['reviews', 'checkpoints'].includes(entry.name)
                ? [] : discover(file, docsRoot);
        }
        return entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = checkExamples({paths: process.argv.length > 2
        ? process.argv.slice(2).map((file) => path.resolve(file)) : undefined});
    if (result.output) console.log(result.output);
    process.exitCode = result.status;
}
