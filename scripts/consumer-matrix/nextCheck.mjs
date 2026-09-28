import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {REPO_ROOT, run} from './matrix.mjs';

/**
 * A Next.js App Router consumer of the packed tarball: a server page imports the package barrel
 * next to two `"use client"` subtrees, then `next build` runs once per bundler. Without the
 * directive on the library's client modules, a server graph that references one evaluates
 * `createContext`/`React.Component` against react-server and fails.
 *
 * Next itself is pinned rather than a range, so a new release cannot move this check; typescript
 * is the repo's own version, because Next typechecks the app during the build.
 */
export const NEXT_VERSION = '16.3.5';
const REACT_VERSION = '19.3.0';
const FIXTURE_DIR = path.join(REPO_ROOT, 'scripts', 'consumer-fixture', 'next');
const MARKERS = ['server:7', 'client:3', 'scoped:5', 'hooks:9:18'];
const BUNDLERS = [{id: 'turbopack', args: []}, {id: 'webpack', args: ['--webpack']}];

const repoTypescript = () => {
    const manifestPath = path.join(REPO_ROOT, 'node_modules', 'typescript', 'package.json');

    return JSON.parse(readFileSync(manifestPath, 'utf8')).version;
};

/**
 * Writes the app and installs it; shared by both bundler builds.
 *
 * @param installDir - the fresh directory the Next app is written into
 * @param tarballPath - the packed tarball installed as the `react-carburetor` dependency
 */
const installNextApp = (installDir, tarballPath) => {
    rmSync(installDir, {recursive: true, force: true});
    mkdirSync(path.join(installDir, 'app'), {recursive: true});

    readdirSync(FIXTURE_DIR).forEach((name) => {
        copyFileSync(path.join(FIXTURE_DIR, name), path.join(installDir, 'app', name));
    });

    writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({
        name: 'consumer-matrix-next',
        private: true,
        version: '0.0.0',
        dependencies: {
            next: NEXT_VERSION,
            react: REACT_VERSION,
            'react-dom': REACT_VERSION,
            'react-carburetor': `file:${tarballPath}`,
        },
        devDependencies: {
            typescript: repoTypescript(),
            '@types/react': '^19',
            '@types/react-dom': '^19',
            '@types/node': '^22',
        },
    }, null, 2));
    // Pins the workspace root: otherwise Next walks up, finds the repo's own lockfile and warns.
    writeFileSync(path.join(installDir, 'next.config.mjs'), [
        "import path from 'node:path';",
        '',
        "export default {turbopack: {root: path.resolve('.')}, outputFileTracingRoot: path.resolve('.')};",
        '',
    ].join('\n'));
    writeFileSync(path.join(installDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            lib: ['dom', 'es2020'],
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            esModuleInterop: true,
            isolatedModules: true,
            plugins: [{name: 'next'}],
        },
        include: ['**/*.ts', '**/*.tsx'],
        exclude: ['node_modules'],
    }, null, 2));

    return run('npm', ['install', '--no-audit', '--no-fund'], {cwd: installDir});
};

/**
 * Builds with one bundler and checks the prerendered page carries every subtree's output.
 *
 * @param installDir - an installed Next app (see installNextApp)
 * @param bundler - which of BUNDLERS to build with
 */
const buildWith = (installDir, bundler) => {
    rmSync(path.join(installDir, '.next'), {recursive: true, force: true});

    const nextBin = path.join(installDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const build = run(process.execPath, [nextBin, 'build', ...bundler.args], {
        cwd: installDir,
        env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
    });

    if (!build.ok) {
        return {ok: false, stage: 'build', stderr: build.stdout + build.stderr};
    }

    const page = path.join(installDir, '.next', 'server', 'app', 'index.html');

    if (!existsSync(page)) {
        return {ok: false, stage: 'prerender', stderr: 'no prerendered index.html'};
    }

    const html = readFileSync(page, 'utf8');
    const missing = MARKERS.filter((marker) => !html.includes(marker));

    return missing.length === 0
        ? {ok: true}
        : {ok: false, stage: 'render', stderr: `missing ${missing.join(', ')} in prerendered page`};
};

/**
 * Installs the Next app and returns one outcome per cell: the install, then each bundler.
 *
 * @param workdir - the consumer-matrix working directory
 * @param tarballPath - the packed tarball under test
 */
export const runNextCheck = (workdir, tarballPath) => {
    const installDir = path.join(workdir, `next${NEXT_VERSION.split('.')[0]}`);
    const install = installNextApp(installDir, tarballPath);
    const label = `next@${NEXT_VERSION}`;

    if (!install.ok) {
        return [
            {cell: `${label}/install`, ok: false, stderr: install.stdout + install.stderr},
            ...BUNDLERS.map((bundler) => ({cell: `${label}/${bundler.id}`, ok: false, stderr: 'install failed'})),
        ];
    }

    return [
        {cell: `${label}/install`, ok: true},
        ...BUNDLERS.map((bundler) => ({cell: `${label}/${bundler.id}`, ...buildWith(installDir, bundler)})),
    ];
};
