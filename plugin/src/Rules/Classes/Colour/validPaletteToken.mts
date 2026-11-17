import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Palette tokens are raw colours in theme selector blocks, referenced only by Roles.
 *
 * Detection lives in the native crate: native/src/rules/classes/colour/valid_palette_token/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validPaletteToken: IRule = nativeRule(
    'carburetor/valid-palette-token',
    'Palette tokens are raw colours in theme selector blocks, referenced only by Roles.'
);
