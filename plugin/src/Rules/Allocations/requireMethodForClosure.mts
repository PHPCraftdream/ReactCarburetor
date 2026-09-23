import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Declare a closure that depends on the class as a method, so it is not rebuilt on every call.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H28.
 */
export const requireMethodForClosure: IRule = nativeRule(
    'carburetor/require-method-for-closure',
    'Declare a closure that depends on the class as a method, so it is not rebuilt on every call.'
);
