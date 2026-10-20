import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Requires a short TSDoc block on functions, methods and function-valued members.
 *
 * Detection lives in the native crate (native/src/rules/style/require_tsdoc/), which the JS
 * plugin calls once per lint run; per-rule options reach that run through
 * `settings.carburetor.ruleOptions`, not through this rule's own config.
 */
export const requireTsdoc: IRule = nativeRule(
    'carburetor/require-tsdoc',
    'Requires a short TSDoc block on functions, methods and function-valued members.'
);
