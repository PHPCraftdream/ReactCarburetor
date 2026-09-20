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
    ],
});
