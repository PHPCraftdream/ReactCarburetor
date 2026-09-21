import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Call the base implementation when overriding a lifecycle method.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H12.
 */
export const requireSuperInLifecycle: IRule = nativeRule(
    'carburetor/require-super-in-lifecycle',
    'Call the base implementation when overriding a lifecycle method.'
);
