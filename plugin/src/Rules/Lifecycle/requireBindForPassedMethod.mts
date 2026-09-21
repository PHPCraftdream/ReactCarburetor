import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Bind a component method with bind before passing it as a value.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H22.
 */
export const requireBindForPassedMethod: IRule = nativeRule(
    'carburetor/require-bind-for-passed-method',
    'Bind a component method with bind before passing it as a value.'
);
