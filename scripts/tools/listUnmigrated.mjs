import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const walk = async (directory) => (await Promise.all(
    (await readdir(directory, {withFileTypes: true})).map(async (item) => {
        const path = resolve(directory, item.name);
        return item.isDirectory() ? walk(path) : item.isFile() && item.name.endsWith('.md') ? [path] : [];
    })
)).flat();
const paths = [resolve(root, 'README.md'), ...(await walk(resolve(root, 'docs')))]
    .filter((path) => !['reviews', 'checkpoints'].some((part) => path.split(sep).includes(part)));
const entries = [];
for (const path of paths) {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
    let ordinal = 0;
    for (let index = 0; index < lines.length; index++) {
        if (!/^\s*`{3,}(?:ts|tsx|js|jsx)\b/.test(lines[index])) continue;
        ordinal++;
        let end = index + 1;
        while (end < lines.length && !/^\s*`{3,}\s*$/.test(lines[end])) end++;
        const before = lines[index - 1]?.trim();
        const isFileMarker = (line) => /^<!--\s*example:file\s/.test(line ?? '');
        const hasFileMarker = isFileMarker(before);
        const markerAboveCompile = before === '<!-- example:compile -->' && isFileMarker(lines[index - 2]?.trim());
        if (!hasFileMarker && !markerAboveCompile) {
            const code = lines.slice(index + 1, end).join('\n');
            entries.push({
                path: relative(root, path).split(sep).join('/'),
                ordinal,
                hash: createHash('sha256').update(code).digest('hex'),
            });
        }
        index = end;
    }
}
await writeFile(resolve(root, 'scripts/tools/unmigrated.json'), `${JSON.stringify({entries}, null, 2)}\n`);
