import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Call useCarburetor and useComputed in render only.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H4.
 */
export const noUseCarburetorOutsideRender: IRule = nativeRule(
    'carburetor/no-use-carburetor-outside-render',
    'Call useCarburetor and useComputed in render only.'
);
