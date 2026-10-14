import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const script = resolve(root, 'scripts/consumer-fixture/checkExamples.mjs');
const imported = `import {checkExamples} from ${JSON.stringify(pathToFileURL(script).href)};`;

function evaluate(expression) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', `${imported} ${expression}`], {encoding: 'utf8'});
}

describe('checkExamples extraction', () => {
    it('extracts marked TS and TSX blocks while ignoring unmarked code and markers in fences', () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-extract-'));
        try {
            const doc = path.join(temp, 'guide.md');
            fs.writeFileSync(doc, ['```md', '<!-- example:compile -->', '```', '```ts', 'ignored;', '```', '<!-- example:compile -->', '```ts', 'const x = 1;', '```', '<!-- example:compile -->', '```tsx', 'const el = <div />;', '```'].join('\n'));
            const result = evaluate(`console.log(JSON.stringify(
                checkExamples({paths:[${JSON.stringify(doc)}], extractOnly:true})
            ));`);
            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout).blocks.map(block => block.language)).toEqual(['ts', 'tsx']);
            expect(JSON.parse(result.stdout).failures).toEqual([]);
        } finally { fs.rmSync(temp, {recursive: true, force: true}); }
    });

    it('reports a marker without a following code fence', () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-missing-'));
        try {
            const doc = path.join(temp, 'guide.md');
            fs.writeFileSync(doc, '<!-- example:compile -->\nplain text\n');
            const result = evaluate(`console.log(JSON.stringify(
                checkExamples({paths:[${JSON.stringify(doc)}], extractOnly:true})
            ));`);
            expect(JSON.parse(result.stdout).failures).toHaveLength(1);
        } finally { fs.rmSync(temp, {recursive: true, force: true}); }
    });

    it('excludes only top-level review and checkpoint archives, and returns zero without examples', () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-discovery-'));
        try {
            const docs = path.join(temp, 'docs');
            fs.mkdirSync(path.join(docs, 'reviews'), {recursive: true});
            fs.mkdirSync(path.join(docs, 'checkpoints'), {recursive: true});
            fs.mkdirSync(path.join(docs, 'nested', 'reviews'), {recursive: true});
            fs.writeFileSync(path.join(temp, 'README.md'), 'No examples.');
            for (const name of ['reviews/old.md', 'checkpoints/old.md']) {
                fs.writeFileSync(path.join(docs, name), '<!-- example:compile -->\n```ts\nconst ignored = 1;\n```');
            }
            fs.writeFileSync(path.join(docs, 'nested', 'reviews', 'included.md'), '<!-- example:compile -->\n```ts\nconst included = 1;\n```');
            const discovery = evaluate(`console.log(JSON.stringify(checkExamples({
                docsRoot:${JSON.stringify(docs)}, readmeRoot:${JSON.stringify(temp)}, extractOnly:true
            })));`);
            expect(discovery.status).toBe(0);
            expect(JSON.parse(discovery.stdout).blocks).toHaveLength(1);
            const empty = evaluate('console.log(JSON.stringify(checkExamples({paths:[]})));');
            expect(JSON.parse(empty.stdout)).toEqual({status: 0, output: 'No marked TypeScript examples found.'});
        } finally { fs.rmSync(temp, {recursive: true, force: true}); }
    });
});

describe('checkExamples end-to-end', () => {
    it('typechecks React examples from outside the repository and reports source locations', () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-e2e-'));
        try {
            const fixture = path.join(temp, 'fixture.md');
            const prefix = '<!-- example:compile -->\n```tsx\n';
            const code = [
                'import React from "react";',
                'import {createRoot} from "react-dom/client";',
                'import {Carburetor} from "react-carburetor";',
                'import {useCarburetorValue} from "react-carburetor/interop";',
                'const root = createRoot(document.createElement("div"));',
                'root.render(<div>{String(Boolean(Carburetor && useCarburetorValue))}</div>);',
            ].join(' ');
            const run = () => spawnSync(process.execPath, [script, fixture], {
                cwd: temp, encoding: 'utf8', timeout: 60000,
            });
            fs.writeFileSync(fixture, prefix + code + '\n```\n');
            const valid = run();
            expect(valid.status).toBe(0);
            expect(valid.stdout).toContain('1 marked TypeScript example passed.');
            fs.writeFileSync(fixture, prefix + code + '\nconst value: string = 42;\n```\n');
            const invalid = run();
            expect(invalid.status).toBe(1);
            expect(invalid.stdout).toContain(`${fixture}:4:`);
            expect(invalid.stdout).toContain('marker line 1');
            expect(invalid.stdout).toContain('error TS2322:');
        } finally { fs.rmSync(temp, {recursive: true, force: true}); }
    }, 150000);
});
