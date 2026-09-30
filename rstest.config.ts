import {defineConfig} from '@rstest/core';
import path from 'node:path';

// The demo app in lib/ has its own node_modules with its own React copy, and the library
// sources live inside that folder. Without pinning, code imported from lib/src would get a
// second React instance whose hook dispatcher is always null.
const rootReact = path.resolve(process.cwd(), 'node_modules', 'react');

const shared = {
    globals: true,
    setupFiles: ['./__tests__/setupTests.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    tools: {
        swc: {
            jsc: {
                transform: {
                    react: {
                        runtime: 'automatic' as const,
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
};

export default defineConfig({
    // oxlint reserves a 6 GiB parser buffer per worker.
    pool: {type: 'forks', maxWorkers: 1},
    projects: [
        {
            ...shared,
            name: 'rules',
            testEnvironment: 'node',
            include: ['__tests__/Plugin/**/*.test.ts'],
        },
        {
            ...shared,
            name: 'runtime',
            testEnvironment: 'jsdom',
            exclude: ['__tests__/Plugin/**'],
        },
    ],
});
