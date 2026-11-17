/**
 * The severity every rule gets in the recommended preset.
 *
 * `error` is for a hazard that silently loses an update, a subscription or a re-render: code that
 * looks right and behaves wrong. `warn` is for the rules that rely on a heuristic — a method name,
 * a dependency array, a decision about what "escapes" — where a false positive is possible and the
 * author has to judge the report. `off` is for `no-module-level-store`, which forbids the correct
 * and recommended pattern in a client-only application and only makes sense once a project renders
 * on a server, and for `one-export-per-file`, an opt-in house style.
 *
 * This map is the single source of truth for both hosts: the ESLint flat config reads it directly,
 * and a test pins `recommended.oxlintrc.json` against it so the JSON a consumer extends cannot
 * drift away from it.
 */
export const RECOMMENDED: Readonly<Record<string, 'error' | 'warn' | 'off'>> = {
    'carburetor/no-async-effect': 'error',
    'carburetor/no-async-transaction': 'error',
    'carburetor/no-closure-in-update': 'warn',
    'carburetor/require-hoisted-constant': 'warn',
    'carburetor/no-computed-get-in-computed': 'error',
    'carburetor/no-computed-get-in-render': 'error',
    'carburetor/no-capturing-hook-selector': 'warn',
    'carburetor/no-direct-data-write': 'warn',
    'carburetor/no-duplicate-effect-name': 'error',
    'carburetor/no-escaping-tracked-data': 'warn',
    'carburetor/no-external-data-mutation': 'error',
    'carburetor/no-function-in-render': 'warn',
    'carburetor/no-get-data-in-render': 'error',
    'carburetor/no-handler-created-in-render': 'warn',
    'carburetor/no-lifecycle-class-property': 'error',
    'carburetor/max-render-depth': 'warn',
    'carburetor/max-line-length': 'off',
    'carburetor/no-blank-line-after-tsdoc': 'off',
    'carburetor/no-parent-import': 'off',
    'carburetor/prefer-readonly-array-param': 'off',
    'carburetor/require-tsdoc': 'off',
    'carburetor/tsdoc-blank-line-before-tags': 'off',
    'carburetor/no-module-level-store': 'off',
    'carburetor/no-unrecognized-base': 'warn',
    'carburetor/no-store-read-in-effect-deps': 'warn',
    'carburetor/no-inline-store-effect': 'error',
    'carburetor/prefer-store-effect': 'warn',
    'carburetor/no-memo-over-store-read': 'warn',
    'carburetor/no-react-hooks-in-components': 'off',
    'carburetor/no-store-write-in-render': 'error',
    'carburetor/no-tracked-data-mutation': 'error',
    'carburetor/no-untrackable-draft-mutation': 'warn',
    'carburetor/no-untrackable-store-data': 'warn',
    'carburetor/no-use-carburetor-outside-render': 'error',
    'carburetor/one-export-per-file': 'off',
    'carburetor/require-bind-for-passed-method': 'error',
    'carburetor/require-effect-deps': 'warn',
    'carburetor/require-emit-after-draft-write': 'error',
    'carburetor/require-method-for-closure': 'warn',
    'carburetor/require-module-function': 'warn',
    'carburetor/require-subscription-disposal': 'warn',
    'carburetor/require-super-in-lifecycle': 'error',
    // The functional-class rules need a `classes` section in `.carburetorrc.json` to know which
    // CSS to read; the native binary turns them on at `error` when it finds one.
    'carburetor/valid-palette-token': 'off',
    'carburetor/valid-color-role': 'off',
    'carburetor/valid-tone-class': 'off',
    'carburetor/valid-trait-class': 'off',
    'carburetor/valid-pattern-class': 'off',
    'carburetor/valid-function-class': 'off',
    'carburetor/no-unknown-class-reference': 'off',
    'carburetor/no-duplicate-class': 'off',
    'carburetor/require-function-class': 'off',
};
