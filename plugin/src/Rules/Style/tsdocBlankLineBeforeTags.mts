import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Requires exactly one blank line between a TSDoc description and its block tags.
 *
 * Detection lives in the native crate
 * (native/src/rules/style/tsdoc_blank_line_before_tags/), which the JS plugin calls once per
 * lint run. The rule autofixes through the native bridge.
 */
export const tsdocBlankLineBeforeTags: IRule = nativeRule(
    'carburetor/tsdoc-blank-line-before-tags',
    'Requires exactly one blank line between a TSDoc description and its block tags.',
    {fixable: 'code'}
);
