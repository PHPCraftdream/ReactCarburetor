/** Default severity map for the house-style preset. */
export const HOUSE_STYLE: Readonly<Record<string, 'error' | 'warn'>> = {
    'carburetor/max-line-length': 'error',
    'carburetor/no-blank-line-after-tsdoc': 'error',
    'carburetor/no-parent-import': 'error',
    'carburetor/prefer-readonly-array-param': 'warn',
    'carburetor/require-tsdoc': 'error',
    'carburetor/tsdoc-blank-line-before-tags': 'error',
    'carburetor/one-export-per-file': 'error',
};
