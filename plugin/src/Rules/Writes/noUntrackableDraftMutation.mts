import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Replace an untrackable value instead of mutating it through draft.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H10.
 */
export const noUntrackableDraftMutation: IRule = nativeRule(
    'carburetor/no-untrackable-draft-mutation',
    'Replace an untrackable value instead of mutating it through draft.'
);
