import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDocs} from '../../../scripts/tools/buildDocs.mjs';

const fixture = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'docs-builder-'));
    await mkdir(join(directory, 'docs'), {recursive: true});
    await writeFile(join(directory, 'README.md'), '');
    return directory;
};
const save = async (root: string, path: string, text: string) => {
    const file = join(root, path);
    await mkdir(join(file, '..'), {recursive: true});
    await writeFile(file, text);
};
const marker = (spec: string, code: string, language = 'tsx') =>
    `<!-- example:file ${spec} -->\n\u0060\u0060\u0060${language}\n${code}\n\u0060\u0060\u0060\n`;

// Region references use the #name suffix, not #region=name.
describe('buildDocs', () => {
    test('extracts full files exactly and dedents selected regions; preserves CRLF and is idempotent', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/full.ts', 'export const value = 1;\n');
            await save(root, 'examples/region.tsx', 'before\n// #region view\n    export const view = <span/>;\n// #endregion view\nafter\n');
            await save(root, 'docs/examples.md', [
                '<!-- example:file examples/full.ts -->', '```tsx', 'old', '```', '',
                '<!-- example:file examples/region.tsx#view -->', '```tsx', 'old', '```', '',
            ].join('\r\n'));
            await buildDocs({directory: root});
            const generated = await readFile(join(root, 'docs/examples.md'), 'utf8');
            expect(generated).toContain('```ts\r\nexport const value = 1;\r\n```');
            expect(generated).toContain('```tsx\r\nexport const view = <span/>;\r\n```');
            await buildDocs({directory: root});
            expect(await readFile(join(root, 'docs/examples.md'), 'utf8')).toEqual(generated);
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('nested regions do not duplicate bodies and malformed regions fail', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/nested.ts', '  // #region outer\n    const before = 1;\n    // #region inner\n      const inside = 2;\n    // #endregion inner\n    const after = 3;\n  // #endregion outer\n');
            await save(root, 'docs/regions.md', marker('examples/nested.ts#outer', 'wrong', 'ts'));
            await buildDocs({directory: root});
            const outer = await readFile(join(root, 'docs/regions.md'), 'utf8');
            expect(outer).toContain('const before = 1;\n  const inside = 2;\nconst after = 3;');
            expect(outer.match(/const inside = 2;/g)).toHaveLength(1);
            await save(root, 'docs/inner.md', marker('examples/nested.ts#inner', 'wrong', 'ts'));
            await buildDocs({directory: root});
            expect(await readFile(join(root, 'docs/inner.md'), 'utf8')).toContain('const inside = 2;');
            await save(root, 'examples/bad.ts', '// #region a\n// #endregion b\n');
            await save(root, 'docs/bad.md', marker('examples/bad.ts#a', 'x', 'ts'));
            await expect(buildDocs({directory: root})).rejects.toThrow('mismatched region end');
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('check mode reports mismatches without writing and language mismatch only in check mode', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/source.ts', 'export const n = 2;\n');
            const original = marker('examples/source.ts', 'export const n = 1;', 'tsx');
            await save(root, 'docs/mismatch.md', original);
            await expect(buildDocs({directory: root, check: true}))
                .rejects.toThrow(/language mismatch.*example content mismatch/s);
            expect(await readFile(join(root, 'docs/mismatch.md'), 'utf8')).toBe(original);
            await buildDocs({directory: root});
            expect(await readFile(join(root, 'docs/mismatch.md'), 'utf8')).toContain('```ts');
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('validates all documents before writing: missing sources, regions, unsafe paths, and fences', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/source.ts', 'export const n = 2;\n');
            await save(root, 'docs/valid.md', marker('examples/source.ts', 'old', 'ts'));
            const original = await readFile(join(root, 'docs/valid.md'), 'utf8');
            await save(root, 'docs/broken.md', [
                marker('examples/missing.ts', 'x', 'ts'),
                marker('../private.ts', 'x', 'ts'),
                marker('examples/source.ts#missing', 'x', 'ts'),
                '```tsx\nunclosed',
            ].join('\n'));
            await expect(buildDocs({directory: root}))
                .rejects.toThrow(/missing source|unsafe example path|missing region|unclosed fence/);
            expect(await readFile(join(root, 'docs/valid.md'), 'utf8')).toBe(original);
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('strict mode rejects unmarked and legacy target blocks without an allowlist', async () => {
        const root = await fixture();
        try {
            await save(root, 'docs/legacy.md', '<!-- example:compile -->\n```ts\nconst legacy = true;\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('missing example:file marker');
            await save(root, 'docs/legacy.md', '```ts\nchanged content\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('missing example:file marker');
            await save(root, 'docs/legacy.md', '```ts\nchanged\n```\n```ts\nadded\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('missing example:file marker');
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('consumes markers, parses JS and JSX, and ignores fake fences inside longer non-code fences', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/a.js', 'const a = 1;\n');
            await save(root, 'examples/b.jsx', 'export default <div/>;\n');
            await save(root, 'docs/examples.md', [
                marker('examples/a.js', 'old', 'ts'), marker('examples/b.jsx', 'old', 'ts'),
                '~~~text\n\ndefault example:file examples/a.js\n\u0060\u0060\u0060tsx\nnot code\n\u0060\u0060\u0060\n~~~\n',
            ].join('\n'));
            await buildDocs({directory: root});
            const result = await readFile(join(root, 'docs/examples.md'), 'utf8');
            expect(result).toContain('```js\nconst a = 1;\n```');
            expect(result).toContain('```jsx\nexport default <div/>;\n```');
            expect(result).toContain('\u0060\u0060\u0060tsx\nnot code');
        } finally { await rm(root, {recursive: true, force: true}); }
    });

    test('reports dangling and malformed markers, and unmarked code', async () => {
        const root = await fixture();
        try {
            await save(root, 'examples/a.ts', 'export const a = 1;\n');
            await save(root, 'docs/broken.md', '<!-- example:file broken -->\nplain prose between markers\n<!-- example:file examples/a.ts -->\n```ts\nx\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('dangling or malformed example marker');
            await save(root, 'docs/prose.md', '```ts\nconst prose = true;\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('missing example:file marker');
            await save(root, 'docs/noncode-marker.md', '<!-- example:file examples/a.ts -->\n```text\nnot code\n```\n');
            await expect(buildDocs({directory: root, check: true})).rejects.toThrow('dangling or malformed example marker');
        } finally { await rm(root, {recursive: true, force: true}); }
    });
});
