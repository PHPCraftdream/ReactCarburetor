import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Every class an @apply names is a Tailwind utility or a class the configured CSS defines.
 *
 * Detection lives in the native crate: native/src/rules/classes/reference/no_unknown_class_reference/.
 * It checks stylesheets, which only the `carburetor-lint` CLI reads: through oxlint or
 * ESLint it never reports on a TypeScript file.
 */
export const noUnknownClassReference: IRule = nativeRule(
    'carburetor/no-unknown-class-reference',
    'Every class an @apply names is a Tailwind utility or a class the configured CSS defines.'
);
