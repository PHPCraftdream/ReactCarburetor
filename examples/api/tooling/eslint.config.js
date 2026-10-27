
// #region doc
import tsParser from '@typescript-eslint/parser';
import carburetor from '@react-carburetor/core/lint';

export default [
    {
        ...carburetor.configs.recommended,
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {parser: tsParser},
    },
    {
        ...carburetor.configs['no-hooks'],
    },
];
// #endregion doc
