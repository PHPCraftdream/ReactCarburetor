import {defineConfig} from '@rslib/core';

const entry = {
    index: ['./lib/src/Carburetor/**', './lib/src/Interop/**'],
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
    ],
});
