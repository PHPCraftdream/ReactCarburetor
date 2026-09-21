import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Give every effect in a component a name of its own.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H15.
 */
export const noDuplicateEffectName: IRule = nativeRule(
    'carburetor/no-duplicate-effect-name',
    'Give every effect in a component a name of its own.'
);
