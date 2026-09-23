import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Declare code that uses nothing from the class at module level, so it is built once.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H29.
 */
export const requireModuleFunction: IRule = nativeRule(
    'carburetor/require-module-function',
    'Declare code that uses nothing from the class at module level, so it is built once.'
);
