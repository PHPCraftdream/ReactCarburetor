import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep plain objects and arrays in a store; convert at the edges.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H19.
 */
export const noUntrackableStoreData: IRule = nativeRule(
    'carburetor/no-untrackable-store-data',
    'Keep plain objects and arrays in a store; convert at the edges.'
);
