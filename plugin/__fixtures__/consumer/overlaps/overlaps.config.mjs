import carburetor from "../../../../dist/lint/index.mjs";

/**
 * The overlap setup: H29 and H30 off, H31 on. Exercised by
 * __tests__/Plugin/packaging.test.ts against the built bundle.
 */
export default [
    {
        ...carburetor.configs.recommended,
        files: ['**/*.jsx'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {ecmaFeatures: {jsx: true}},
        },
        rules: {
            'carburetor/require-method-for-closure': 'off',
            'carburetor/require-module-function': 'off',
            'carburetor/no-function-in-render': 'warn',
        },
    },
];
