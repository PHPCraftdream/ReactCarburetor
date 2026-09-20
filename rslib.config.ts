import {defineConfig} from '@rslib/core';

export default defineConfig({
    source: {
        entry: {
            index: ['./lib/src/Carburetor/**'],
        },
    },
    lib: [
        {
            format: 'cjs',
            bundle: false,
            dts: true,
        },
    ],
});
