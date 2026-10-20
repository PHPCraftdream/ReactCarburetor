import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Disallows a blank line between a TSDoc block and the declaration it documents.
 *
 * Detection lives in the native crate
 * (native/src/rules/style/no_blank_line_after_tsdoc/), which the JS plugin calls once per
 * lint run.
 */
export const noBlankLineAfterTsdoc: IRule = nativeRule(
    'carburetor/no-blank-line-after-tsdoc',
    'Disallows a blank line between a TSDoc block and the declaration it documents.'
);
