import carburetor from '../../../dist/lint/index.mjs';

export default [{
    ...carburetor.configs['no-hooks'],
    files: ['**/*.jsx'],
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: {ecmaFeatures: {jsx: true}},
    },
}];
