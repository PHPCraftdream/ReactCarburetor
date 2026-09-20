import {defineConfig} from '@rslib/core';

const entry = {
    index: ['./lib/src/Carburetor/**', './lib/src/Interop/**'],
};

/**
 * Development-only diagnostics are guarded by a literal `process.env.NODE_ENV` comparison.
 * The default outputs leave that expression in place, so a consumer's bundler substitutes it
 * and drops the guarded blocks. The `-prod` outputs have it substituted here instead, for
 * consumers whose toolchain does not do that — they are selected by the `production`
 * condition in package.json exports.
 */
const productionDefine = {
    'process.env.NODE_ENV': JSON.stringify('production'),
};

/**
 * The lint plugin ships as one bundled file per format, unlike the library.
 *
 * Its sources import each other through the `#src/*` subpath map in `plugin/package.json`, which
 * only resolves inside this repository; bundling inlines those imports so nothing in the published
 * file depends on them. Types are hand-written in `plugin/lint.d.ts` — see the note there — and the
 * oxlint preset travels next to the plugin so a consumer can `extends` it, since oxlint resolves an
 * extended config's own `jsPlugins` paths relative to that config.
 */
const pluginEntry = {
    index: './plugin/src/index.mts',
};

const pluginAssets = [
    {from: './plugin/recommended.oxlintrc.json', to: './recommended.oxlintrc.json'},
    {from: './plugin/lint.d.ts', to: './index.d.mts'},
    {from: './plugin/lint.d.ts', to: './index.d.cts'},
];

export default defineConfig({
    lib: [
        {
            format: 'esm',
            bundle: false,
            dts: {autoExtension: true},
            source: {entry},
            output: {distPath: {root: './dist/esm'}},
        },
        {
            format: 'cjs',
            bundle: false,
            dts: true,
            source: {entry},
            output: {distPath: {root: './dist/cjs'}},
        },
        {
            format: 'esm',
            bundle: false,
            dts: false,
            source: {entry, define: productionDefine},
            output: {distPath: {root: './dist/esm-prod'}, minify: true},
        },
        {
            format: 'cjs',
            bundle: false,
            dts: false,
            source: {entry, define: productionDefine},
            output: {distPath: {root: './dist/cjs-prod'}, minify: true},
        },
        {
            format: 'esm',
            bundle: true,
            dts: false,
            source: {entry: pluginEntry},
            output: {
                distPath: {root: './dist/lint'},
                filename: {js: 'index.mjs'},
                copy: pluginAssets,
            },
        },
        {
            format: 'cjs',
            bundle: true,
            dts: false,
            source: {entry: pluginEntry},
            output: {distPath: {root: './dist/lint'}, filename: {js: 'index.cjs'}},
        },
    ],
});
