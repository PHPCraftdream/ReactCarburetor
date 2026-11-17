import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Do not change a store while rendering.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H11.
 */
export const noStoreWriteInRender: IRule = nativeRule(
    'carburetor/no-store-write-in-render',
    'Do not change a store while rendering.'
);
