import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Roles follow the family-slot-state grammar, live in @theme after the reset, point at the Palette.
 *
 * Detection lives in the native crate: native/src/rules/classes/colour/valid_color_role/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validColorRole: IRule = nativeRule(
    'carburetor/valid-color-role',
    'Roles follow the family-slot-state grammar, live in @theme after the reset, point at the Palette.'
);
