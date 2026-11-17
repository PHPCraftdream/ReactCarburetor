import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Write through draft, which records the changed paths.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H7.
 */
export const noDirectDataWrite: IRule = nativeRule(
    'carburetor/no-direct-data-write',
    'Write through draft, which records the changed paths.'
);
