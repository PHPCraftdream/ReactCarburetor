import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * List the props and state an effect reads in its dependency array.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H16.
 */
export const requireEffectDeps: IRule = nativeRule(
    'carburetor/require-effect-deps',
    'List the props and state an effect reads in its dependency array.'
);
