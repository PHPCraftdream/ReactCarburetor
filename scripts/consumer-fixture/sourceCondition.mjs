import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {REPO_ROOT, TSC_BIN, WORKDIR, run} from '../consumer-matrix/matrix.mjs';

const require = createRequire(import.meta.url);
const dir = path.join(WORKDIR, 'source-condition');
const normalize = value => realpathSync(value).replaceAll('\\', '/');
const source = normalize(REPO_ROOT);
const packageManifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const library = JSON.parse(readFileSync(path.join(REPO_ROOT, 'lib', 'package.json'), 'utf8'));
const pinned = name => {
    try {
        const manifest = require.resolve(`${name}/package.json`, {paths: [REPO_ROOT]});
        return JSON.parse(readFileSync(manifest, 'utf8')).version;
    }
    catch { return undefined; }
};
const dependencies = {
    react: packageManifest.devDependencies.react,
    'react-dom': packageManifest.devDependencies['react-dom'],
    '@types/react': packageManifest.devDependencies['@types/react'],
    '@types/react-dom': packageManifest.devDependencies['@types/react-dom'],
    '@rsbuild/core': pinned('@rsbuild/core') || library.devDependencies['@rsbuild/core'],
    '@rsbuild/plugin-react': pinned('@rsbuild/plugin-react') || library.devDependencies['@rsbuild/plugin-react'],
    'react-carburetor': `file:${source}`,
};

/** Run the linked-source consumer typecheck, resolution assertion, and bundler build. */
export const sourceConditionScenario = () => {
    rmSync(dir, {recursive: true, force: true});
    mkdirSync(path.join(dir, 'src'), {recursive: true});
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'consumer-source-condition', private: true,
        dependencies}, null, 2));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({compilerOptions: {
        target: 'ES2021', lib: ['ES2021', 'ES2021.WeakRef', 'DOM'], module: 'ESNext', moduleResolution: 'bundler',
        customConditions: ['carburetor-source'], jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true,
        esModuleInterop: true, types: [],
    }, include: ['src/**/*']}, null, 2));
    writeFileSync(path.join(dir, 'src', 'index.tsx'), [
        "import {Carburetor} from 'react-carburetor';",
        "import {useCarburetorValue} from 'react-carburetor/interop';",
        "import {flush, createTestScope} from 'react-carburetor/testing';",
        "import {createRoot} from 'react-dom/client';",
        'const store = new Carburetor({count: 1});',
        'const App = () => <span>{useCarburetorValue(store, value => value.count)}</span>;',
        "const root = createRoot(document.getElementById('root')!);",
        'root.render(<App />);',
        'const scope = createTestScope(); flush(scope); scope.dispose();',
    ].join('\n'));
    writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
    writeFileSync(path.join(dir, 'rsbuild.config.ts'), [
        "import {realpathSync} from 'node:fs';",
        "import {defineConfig} from '@rsbuild/core';",
        "import {pluginReact} from '@rsbuild/plugin-react';",
        "export default defineConfig({plugins: [pluginReact()], source: {entry: {index: './src/index.tsx'},",
        "include: [realpathSync('./node_modules/react-carburetor/lib/src')]}, html: {template: './index.html'},",
        "resolve: {conditionNames: ['carburetor-source', '...']}});",
    ].join('\n'));
    const install = run('npm', ['install', '--install-links=false', '--ignore-scripts', '--no-audit', '--no-fund'],
        {cwd: dir});
    if (!install.ok) return {ok: false, stage: 'install', stderr: install.stdout + install.stderr};
    if (normalize(path.join(dir, 'node_modules', 'react-carburetor')) !== source)
        return {ok: false, stage: 'link', stderr: 'file dependency does not resolve to the checkout'};
    const typecheck = run(process.execPath, [TSC_BIN, '--noEmit', '-p', 'tsconfig.json'], {cwd: dir});
    if (!typecheck.ok) return {ok: false, stage: 'typecheck', stderr: typecheck.stdout + typecheck.stderr};
    const trace = run(process.execPath, [TSC_BIN, '--noEmit', '--traceResolution', '-p', 'tsconfig.json'], {cwd: dir});
    const output = trace.stdout.replaceAll('\\', '/');
    const resolved = ['/lib/src/Carburetor/index.ts', '/lib/src/Interop/index.ts', '/lib/src/Testing/index.ts'];
    if (!trace.ok || resolved.some(target => !output.includes(`successfully resolved to '${source}${target}'`)))
        return {ok: false, stage: 'source-resolution', stderr: trace.stdout + trace.stderr};
    const rsbuildBin = path.join(dir, 'node_modules/@rsbuild/core/bin/rsbuild.js');
    const rsbuild = run(process.execPath, [rsbuildBin, 'build'], {cwd: dir});
    return rsbuild.ok ? {ok: true} : {ok: false, stage: 'build', stderr: rsbuild.stdout + rsbuild.stderr};
};
