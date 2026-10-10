import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {resource41Checks} from './round41/resource41Checks.mjs';
import {FIXTURE, TSC_BIN, pnpmCommand, run} from './matrix.mjs';

/**
 * One `npm`/`pnpm install` per (React version, package manager) — shared by both formats.
 *
 * @param installDir - the fresh directory the consumer project is written into
 * @param reactVersion - the cell's react/react-dom/@types version set
 * @param packageManager - 'npm' or 'pnpm'
 * @param tarballPath - the packed tarball installed as the `react-carburetor` dependency
 */
export const installConsumer = (installDir, reactVersion, packageManager, tarballPath) => {
    rmSync(installDir, {recursive: true, force: true});
    mkdirSync(installDir, {recursive: true});

    writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({
        name: 'consumer-matrix-fixture',
        private: true,
        version: '0.0.0',
        dependencies: {
            react: reactVersion.react,
            'react-dom': reactVersion.reactDom,
            '@types/react': `^${reactVersion.types}`,
            '@types/react-dom': `^${reactVersion.types}`,
            'react-carburetor': `file:${tarballPath}`,
        },
    }, null, 2));

    if (packageManager === 'npm') {
        return run('npm', ['install', '--no-audit', '--no-fund'], {cwd: installDir});
    }

    const pnpm = pnpmCommand();

    if (!pnpm) {
        return {ok: false, skip: true, stderr: 'pnpm is not available locally (no corepack, no pnpm binary)'};
    }

    return run(pnpm.command, [...pnpm.prefix, 'install', '--no-frozen-lockfile'], {cwd: installDir});
};

const TSCONFIG = (format) => ({
    compilerOptions: {
        target: 'ES2020',
        module: format === 'esm' ? 'ESNext' : 'CommonJS',
        moduleResolution: 'bundler',
        lib: ['ES2020', 'DOM'],
        jsx: 'react-jsx',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        // A separate outDir, not "."/rootDir: tsc treats outDir === rootDir as "the output
        // directory contains the input", auto-excludes it, and finds nothing to compile.
        outDir: 'out',
        rootDir: '.',
        types: [],
    },
    include: ['consumer.tsx'],
});

const HARNESS_ESM = `import * as React from 'react';
import {renderToString} from 'react-dom/server';
import {App, registry, publishReadable} from './out/consumer.js';

const html = renderToString(React.createElement(App));
publishReadable({count: 9}, new Set(['count']));
const refreshed = renderToString(React.createElement(App));
const checks = [
    ['direct output', html.includes('direct:1:1:2:idle')],
    ['scoped output', html.includes('scoped:5')],
    ['hooks output', html.includes('hooks:1:2')],
    ['readable class output', html.includes('readable:7:7:7')],
    ['readable hook output', html.includes('hooks:1:2:readable:7:7')],
    ['readable class refresh', refreshed.includes('readable:9:9:9')],
    ['readable computed freshness', refreshed.includes('hooks:1:2:readable:9:9')],
    ['instanceof this React.Component', registry.instance instanceof React.Component],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);

if (failed.length > 0) {
    console.error('FAIL: ' + failed.join(', ') + ' -- html: ' + html);
    process.exit(1);
}

console.log('OK');
`;

const HARNESS_CJS = `const React = require('react');
const {renderToString} = require('react-dom/server');
const {App, registry, publishReadable} = require('./out/consumer.js');

const html = renderToString(React.createElement(App));
publishReadable({count: 9}, new Set(['count']));
const refreshed = renderToString(React.createElement(App));
const checks = [
    ['direct output', html.includes('direct:1:1:2:idle')],
    ['scoped output', html.includes('scoped:5')],
    ['hooks output', html.includes('hooks:1:2')],
    ['readable class output', html.includes('readable:7:7:7')],
    ['readable hook output', html.includes('hooks:1:2:readable:7:7')],
    ['readable class refresh', refreshed.includes('readable:9:9:9')],
    ['readable computed freshness', refreshed.includes('hooks:1:2:readable:9:9')],
    ['instanceof this React.Component', registry.instance instanceof React.Component],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);

if (failed.length > 0) {
    console.error('FAIL: ' + failed.join(', ') + ' -- html: ' + html);
    process.exit(1);
}

console.log('OK');
`;

/**
 * Typechecks + compiles the fixture for one module format, then runs the smoke harness.
 *
 * @param installDir - an already-installed consumer directory (see installConsumer)
 * @param format - 'esm' or 'cjs'
 */
export const checkFormat = (installDir, format) => {
    const formatDir = path.join(installDir, `run-${format}`);

    mkdirSync(formatDir, {recursive: true});
    writeFileSync(path.join(formatDir, 'consumer.tsx'), readFileSync(FIXTURE, 'utf8'));
    writeFileSync(path.join(formatDir, 'tsconfig.json'), JSON.stringify(TSCONFIG(format), null, 2));
    writeFileSync(path.join(formatDir, 'package.json'), JSON.stringify({
        type: format === 'esm' ? 'module' : 'commonjs',
    }, null, 2));

    const typecheck = run(process.execPath, [TSC_BIN, '-p', 'tsconfig.json'], {cwd: formatDir});

    if (!typecheck.ok) {
        return {ok: false, stage: 'typecheck', stderr: typecheck.stdout + typecheck.stderr};
    }

    const harnessName = format === 'esm' ? 'harness.mjs' : 'harness.cjs';

    writeFileSync(path.join(formatDir, harnessName), format === 'esm' ? HARNESS_ESM : HARNESS_CJS);

    const smoke = run(process.execPath, [harnessName], {cwd: formatDir});

    if (!smoke.ok) {
        return {ok: false, stage: 'runtime', stderr: smoke.stdout + smoke.stderr};
    }

    writeFileSync(path.join(formatDir, 'computed41Checks.mjs'), readFileSync(
        new URL('./round41/computed41Checks.mjs', import.meta.url), 'utf8'
    ));
    writeFileSync(path.join(formatDir, 'computed41.mjs'), `
import assert from 'node:assert/strict';
${format === 'esm' ? "import * as engine from 'react-carburetor';" : "import {createRequire} from 'node:module'; const engine = createRequire(import.meta.url)('react-carburetor');"}
import {computed41Checks} from './computed41Checks.mjs';
computed41Checks(assert, engine, engine, ${JSON.stringify(format)});
`);
    const computed = run(process.execPath, ['computed41.mjs'], {cwd: formatDir});
    if (!computed.ok) return {ok: false, stage: 'computed41', stderr: computed.stdout + computed.stderr};
    for (const condition of ['development', 'production']) {
        const resources = resource41Checks(formatDir, format, condition);
        if (!resources.ok) return resources;
    }
    return {ok: true};
};
