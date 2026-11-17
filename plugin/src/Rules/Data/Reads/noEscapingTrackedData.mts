import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Use tracked data inside the render that read it.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H5.
 */
export const noEscapingTrackedData: IRule = nativeRule(
    'carburetor/no-escaping-tracked-data',
    'Use tracked data inside the render that read it.'
);
