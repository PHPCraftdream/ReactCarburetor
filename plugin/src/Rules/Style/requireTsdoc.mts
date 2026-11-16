import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Requires a short TSDoc block on functions, methods and function-valued members.
 *
 * Detection lives in the native crate (native/src/rules/style/require_tsdoc/), which the JS
 * plugin calls once per lint run; the rule's own options (`["error", {...}]`) reach that run, over
 * any given for it in `settings.carburetor.ruleOptions`.
 */
export const requireTsdoc: IRule = nativeRule(
    'carburetor/require-tsdoc',
    'Requires a short TSDoc block on functions, methods and function-valued members.',
    {schema: [{type: 'object'}], forwardOptions: true}
);
