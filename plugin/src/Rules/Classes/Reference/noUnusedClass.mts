import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Palette tokens, Roles, Tones, Traits and Patterns that nothing in the configured CSS uses.
 *
 * Detection lives in the native crate: native/src/rules/classes/reference/no_unused_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads, and it is off until switched
 * on, even with a `classes` section.
 */
export const noUnusedClass: IRule = nativeRule(
    'carburetor/no-unused-class',
    'Palette tokens, Roles, Tones, Traits and Patterns that nothing in the configured CSS uses.'
);
