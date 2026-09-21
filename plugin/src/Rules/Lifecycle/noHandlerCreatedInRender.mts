import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Pass a stable handler to a child component, bound once with bind.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H21.
 */
export const noHandlerCreatedInRender: IRule = nativeRule(
    'carburetor/no-handler-created-in-render',
    'Pass a stable handler to a child component, bound once with bind.'
);
