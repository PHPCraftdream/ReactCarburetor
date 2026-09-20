import carburetor from "../../../dist/lint/index.mjs";

/**
 * The setup a consumer writes, exercised by __tests__/Plugin/packaging.test.ts against the built
 * bundle: spread the shipped preset and point it at their files.
 *
 * The oxlint half lives in oxlintrc.json next to this file. It is deliberately not named
 * `.oxlintrc.json`: oxlint discovers nested configs by that name, and this one registers the
 * bundled plugin under the same name the repository's own config registers the source plugin under,
 * which collides. The test passes it with -c, so the name changes nothing about what is verified.
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
    },
];
