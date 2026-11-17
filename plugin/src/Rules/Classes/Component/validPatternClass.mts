import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Patterns apply only Traits.
 *
 * Detection lives in the native crate: native/src/rules/classes/component/valid_pattern_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validPatternClass: IRule = nativeRule(
    'carburetor/valid-pattern-class',
    'Patterns apply only Traits.'
);
