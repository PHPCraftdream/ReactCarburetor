/**
 * The severity every rule gets in the recommended preset.
 *
 * `error` is for a hazard that silently loses an update, a subscription or a re-render: code that
 * looks right and behaves wrong. `warn` is for the rules that rely on a heuristic — a method name,
 * a dependency array, a decision about what "escapes" — where a false positive is possible and the
 * author has to judge the report. `off` is for `no-module-level-store`, which forbids the correct
 * and recommended pattern in a client-only application and only makes sense once a project renders
 * on a server.
 *
 * This map is the single source of truth for both hosts: the ESLint flat config reads it directly,
 * and a test pins `recommended.oxlintrc.json` against it so the JSON a consumer extends cannot
 * drift away from it.
 */
export const RECOMMENDED: Readonly<Record<string, 'error' | 'warn' | 'off'>> = {
    'carburetor/no-async-effect': 'error',
    'carburetor/no-async-transaction': 'error',
    'carburetor/no-computed-get-in-computed': 'error',
    'carburetor/no-computed-get-in-render': 'error',
    'carburetor/no-direct-data-write': 'warn',
    'carburetor/no-duplicate-effect-name': 'error',
    'carburetor/no-escaping-tracked-data': 'warn',
    'carburetor/no-external-data-mutation': 'error',
    'carburetor/no-get-data-in-render': 'error',
    'carburetor/no-handler-created-in-render': 'warn',
    'carburetor/no-lifecycle-class-property': 'error',
    'carburetor/no-module-level-store': 'off',
    'carburetor/no-store-write-in-render': 'error',
    'carburetor/no-tracked-data-mutation': 'error',
    'carburetor/no-untrackable-draft-mutation': 'warn',
    'carburetor/no-untrackable-store-data': 'warn',
    'carburetor/no-use-carburetor-outside-render': 'error',
    'carburetor/require-bind-for-passed-method': 'error',
    'carburetor/require-effect-deps': 'warn',
    'carburetor/require-emit-after-draft-write': 'error',
    'carburetor/require-method-for-closure': 'warn',
    'carburetor/require-module-function': 'warn',
    'carburetor/require-subscription-disposal': 'warn',
    'carburetor/require-super-in-lifecycle': 'error',
};
