/** Optional architectural policy; it does not replace the recommended correctness rules. */
export const NO_HOOKS: Readonly<Record<string, 'error' | 'warn' | 'off'>> = {
    'carburetor/no-react-hooks-in-components': 'error',
};
