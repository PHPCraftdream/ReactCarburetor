import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Enforces the maximum length of a source line.
 *
 * Detection lives in the native crate (native/src/rules/style/max_line_length/), which the JS
 * plugin calls once per lint run; the rule's own options (`["error", {...}]`) reach that run, over
 * any given for it in `settings.carburetor.ruleOptions`.
 */
export const maxLineLength: IRule = nativeRule(
    'carburetor/max-line-length',
    'Enforces the maximum length of a source line.',
    {schema: [{type: 'object'}], forwardOptions: true}
);
