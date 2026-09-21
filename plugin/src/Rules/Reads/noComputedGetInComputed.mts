import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Inside a computed, read sources through the reader it is given.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H3.
 */
export const noComputedGetInComputed: IRule = nativeRule(
    'carburetor/no-computed-get-in-computed',
    'Inside a computed, read sources through the reader it is given.'
);
