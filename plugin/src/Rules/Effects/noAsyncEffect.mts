import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep an effect body synchronous so its cleanup survives.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H14.
 */
export const noAsyncEffect: IRule = nativeRule(
    'carburetor/no-async-effect',
    'Keep an effect body synchronous so its cleanup survives.'
);
