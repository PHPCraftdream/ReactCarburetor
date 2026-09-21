import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Publish a draft write, ideally through update(draft => new state).
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H6.
 */
export const requireEmitAfterDraftWrite: IRule = nativeRule(
    'carburetor/require-emit-after-draft-write',
    'Publish a draft write, ideally through update(draft => new state).'
);
