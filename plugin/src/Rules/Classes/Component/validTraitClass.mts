import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Traits apply only non-colour Bricks setting the properties their kind owns.
 *
 * Detection lives in the native crate: native/src/rules/classes/component/valid_trait_class/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const validTraitClass: IRule = nativeRule(
    'carburetor/valid-trait-class',
    'Traits apply only non-colour Bricks setting the properties their kind owns.'
);
