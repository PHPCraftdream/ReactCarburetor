import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * One composition sets each property once: the order of @apply never decides a value.
 *
 * Detection lives in the native crate: native/src/rules/classes/component/no_conflicting_classes/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const noConflictingClasses: IRule = nativeRule(
    'carburetor/no-conflicting-classes',
    'One composition sets each property once: the order of @apply never decides a value.'
);
