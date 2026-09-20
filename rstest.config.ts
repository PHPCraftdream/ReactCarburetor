import {defineConfig} from '@rstest/core';

export default defineConfig({
    globals: true,
    testEnvironment: 'jsdom',
    setupFiles: ['./__tests__/setupTests.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
});
