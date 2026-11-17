import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Every Palette token, Role and class is defined once across the configured CSS.
 *
 * Detection lives in the native crate: native/src/rules/classes/reference/no_duplicate_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const noDuplicateClass: IRule = nativeRule(
    'carburetor/no-duplicate-class',
    'Every Palette token, Role and class is defined once across the configured CSS.'
);
