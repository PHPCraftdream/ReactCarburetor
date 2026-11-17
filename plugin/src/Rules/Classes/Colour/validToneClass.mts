import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Tones apply only colour Bricks on Roles of their own family and delivery.
 *
 * Detection lives in the native crate: native/src/rules/classes/colour/valid_tone_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validToneClass: IRule = nativeRule(
    'carburetor/valid-tone-class',
    'Tones apply only colour Bricks on Roles of their own family and delivery.'
);
