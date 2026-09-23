import {defineConfig} from '@rstest/core';
import path from 'node:path';

// The demo app in lib/ has its own node_modules with its own React copy, and the library
// sources live inside that folder. Without pinning, code imported from lib/src would get a
// second React instance whose hook dispatcher is always null.
const rootReact = path.resolve(process.cwd(), 'node_modules', 'react');

export default defineConfig({
    globals: true,
    testEnvironment: 'jsdom',
    setupFiles: ['./__tests__/setupTests.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    tools: {
        swc: {
            jsc: {
                transform: {
                    react: {
                        runtime: 'automatic',
                    },
                },
            },
        },
    },
    resolve: {
        alias: {
            react$: rootReact,
        },
    },
});
