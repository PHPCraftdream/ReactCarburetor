import {readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const languages = {'.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx'};
const markerPattern = /^\s*<!--\s*example:file\s+([^\s]+)\s*-->\s*$/;
const markerLike = /^\s*<!--\s*example:file\b/;
const prefixPattern = /^((?:[ \t]|>[ \t]?)+)/; // leading indent and/or blockquote markers
const quotePattern = /^[ \t]*(?:>[ \t]?)+/; // blockquote markers with optional indent
const stripPrefix = (line) => {
    const match = line.match(prefixPattern);
    return match ? [match[1], line.slice(match[1].length)] : ['', line];
};
const stripQuote = (line) => line.replace(quotePattern, '');
const cutPrefix = (line, prefix) => line.startsWith(prefix) ? line.slice(prefix.length) : line;
const fencePattern = /^\s*(`{3,}|~{3,})(?:\s*([^\s`~]+).*)?\s*$/;
const trimLine = (line) => line.replace(/\r?\n$/, '');
const walk = async (directory, exclude = new Set()) => (await Promise.all(
    (await readdir(directory, {withFileTypes: true})).map(async (item) => {
        const path = resolve(directory, item.name);
        if (exclude.has(item.name)) return [];
        return item.isDirectory() ? walk(path) : item.isFile() && item.name.endsWith('.md') ? [path] : [];
    })
)).flat();
const parseRegions = (source) => {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const stack = [];
    const regions = new Map();
    const clean = [];
    for (const line of lines) {
        const opening = line.match(/^\s*\/\/\s*#region\s+([\w-]+)\s*$/);
        const closing = line.match(/^\s*\/\/\s*#endregion(?:\s+([\w-]+))?\s*$/);
        if (opening) {
            const name = opening[1];
            if (regions.has(name) || stack.some((entry) => entry.name === name)) {
                throw new Error(`duplicate region ${name}`);
            }
            stack.push({name, lines: []});
        } else if (closing) {
            const active = stack.pop();
            if (!active || (closing[1] && closing[1] !== active.name)) throw new Error('mismatched region end');
            regions.set(active.name, active.lines.join('\n'));
        } else {
            clean.push(line);
            for (const entry of stack) entry.lines.push(line);
        }
    }
    if (stack.length) throw new Error(`unclosed region ${stack.at(-1).name}`);
    return {regions, clean: clean.join('\n').replace(/\n$/, '')};
};
const dedent = (source) => {
    const lines = source.split('\n');
    const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length);
    const amount = indents.length ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(Math.min(amount, line.match(/^\s*/)[0].length))).join('\n');
};
const sourceFor = async (base, spec) => {
    const match = spec.match(/^([A-Za-z0-9_./-]+)(?:#([A-Za-z0-9_-]+))?$/);
    if (!match || !match[1].startsWith('examples/') || match[1].split('/').includes('..')) throw new Error('unsafe example path');
    const sourcePath = resolve(base, match[1]);
    if (!sourcePath.startsWith(resolve(base, 'examples') + sep) || !languages[extname(sourcePath)]) throw new Error('unsupported or unsafe source path');
    const parsed = parseRegions(await readFile(sourcePath, 'utf8'));
    let code;
    if (match[2]) {
        if (!parsed.regions.has(match[2])) throw new Error(`missing region ${match[2]}`);
        code = dedent(parsed.regions.get(match[2]));
    } else code = parsed.clean;
    return {language: languages[extname(sourcePath)], code: code.replace(/\n$/, '')};
};

/**
 * Synchronizes `example:file`-marked TypeScript and JavaScript fences in README.md and docs/
 * from their example sources, without writing anything in `check` mode.
 *
 * Every target-language fence must carry an `example:file` marker; unmarked fences are errors.
 */
export async function buildDocs({check = false, directory = root} = {}) {
    const base = resolve(directory);
    const errors = [];
    const docs = [
        resolve(base, 'README.md'),
        ...(await walk(resolve(base, 'docs'), new Set(['reviews', 'checkpoints']))),
    ];
    const pending = [];
    for (const path of docs) {
        const original = await readFile(path, 'utf8');
        const lines = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        const output = [];
        const document = relative(base, path).split(sep).join('/');
        let ordinal = 0;
        let index = 0;
        while (index < lines.length) {
            const raw = trimLine(lines[index]);
            const [, line] = stripPrefix(raw);
            const opening = line.match(fencePattern);
            if (!opening) {
                if (markerLike.test(line)) {
                    let next = index + 1;
                    while (next < lines.length && markerLike.test(trimLine(lines[next]))) next++;
                    const candidate = stripQuote(trimLine(lines[next]));
                    const candidateFence = candidate.match(fencePattern);
                    const codeFollows = candidateFence !== null
                        && Object.values(languages).includes((candidateFence[2] ?? '').toLowerCase());
                    if (!codeFollows) errors.push(`${document}:${index + 1}: dangling or malformed example marker`);
                }
                output.push(lines[index++]);
                continue;
            }
            const fence = opening[1];
            const prefix = stripPrefix(raw)[0]; // container prefix of the whole block
            const closer = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
            let end = index + 1;
            while (end < lines.length && !closer.test(cutPrefix(trimLine(lines[end]), prefix))) end++;
            if (end >= lines.length) {
                errors.push(`${document}: unclosed fence`);
                output.push(...lines.slice(index));
                break;
            }
            const language = (opening[2] ?? '').toLowerCase();
            if (!Object.values(languages).includes(language)) {
                output.push(...lines.slice(index, end + 1)); index = end + 1; continue;
            }
            ordinal++;
            // count consecutive marker lines immediately above the fence
            let chain = 0;
            while (index - 1 - chain >= 0 && markerLike.test(stripQuote(trimLine(lines[index - 1 - chain])))) chain++;
            if (chain > 1) errors.push(`${document}:${index - chain + 1}: duplicate example:file marker`);
            const markerText = chain ? stripQuote(trimLine(lines[index - 1])) : '';
            const markerMatch = markerText.match(markerPattern);
            const marked = markerLike.test(markerText);
            if (marked && !markerMatch) errors.push(`${document}:${ordinal}: malformed example:file marker`);
            if (markerMatch) {
                try {
                    const extracted = await sourceFor(base, markerMatch[1]);
                    if (check && language !== extracted.language) {
                        errors.push(`${document}:${ordinal}: language mismatch (expected ${extracted.language})`);
                    }
                    const body = lines.slice(index + 1, end)
                        .map((part) => cutPrefix(trimLine(part), prefix)).join('\n');
                    if (check && body !== extracted.code) {
                        errors.push(`${document}:${ordinal}: example content mismatch`);
                    }
                    if (!check) {
                        const ending = lines[end].endsWith('\n') ? '\n' : '';
                        const newline = original.includes('\r\n') ? '\r\n' : '\n';
                        // Outlast the longest run of fence characters inside the code.
                        const runs = extracted.code.match(new RegExp(`\\${fence[0]}+`, 'g')) ?? [];
                        const run = Math.max(0, ...runs.map((found) => found.length));
                        const length = Math.max(3, fence.length, run + 1);
                        const info = opening[2]?.slice(language.length) ?? '';
                        output.push(`${prefix}${fence[0].repeat(length)}${extracted.language}${info}${newline}`);
                        if (extracted.code) {
                            output.push(extracted.code.split('\n')
                                .map((part) => `${prefix}${part}${newline}`).join(''));
                        }
                        output.push(`${prefix}${fence[0].repeat(length)}${ending ? newline : ''}`);
                    } else output.push(...lines.slice(index, end + 1));
                } catch (error) {
                    const message = error.code === 'ENOENT'
                        ? `missing source ${markerMatch[1].split('#')[0]}`
                        : error.message;
                    errors.push(`${document}:${ordinal}: ${message}`);
                    output.push(...lines.slice(index, end + 1));
                }
            } else {
                errors.push(`${document}:${ordinal}: missing example:file marker`);
                output.push(...lines.slice(index, end + 1));
            }
            index = end + 1;
        }
        const result = output.join('');
        if (!check && result !== original) pending.push([path, result]);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    if (!check) for (const [path, content] of pending) await writeFile(path, content);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildDocs({check: process.argv.includes('--check')}).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
