import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Functions live in @layer components and apply a Pattern, Traits and exactly one Tone.
 *
 * Detection lives in the native crate: native/src/rules/classes/component/valid_function_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validFunctionClass: IRule = nativeRule(
    'carburetor/valid-function-class',
    'Functions live in @layer components and apply a Pattern, Traits and exactly one Tone.'
);
