import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Build a collection or string made only of constants once, at module level, not on every call.
 *
 * Detection lives in the native crate (native/src/rules/allocations/hoisting/require_hoisted_constant.rs),
 * which the JS plugin calls once per lint run and reports through -- see
 * plugin/src/Utils/Native/nativeBridge.mts for why.
 */
export const requireHoistedConstant: IRule = nativeRule(
    'carburetor/require-hoisted-constant',
    'Build a collection or string made only of constants once, at module level, not on every call.'
);
