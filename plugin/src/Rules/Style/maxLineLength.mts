import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Enforces the maximum length of a source line.
 *
 * Detection lives in the native crate (native/src/rules/style/max_line_length/), which the JS
 * plugin calls once per lint run; per-rule options reach that run through
 * `settings.carburetor.ruleOptions`, not through this rule's own config.
 */
export const maxLineLength: IRule = nativeRule(
    'carburetor/max-line-length',
    'Enforces the maximum length of a source line.'
);
