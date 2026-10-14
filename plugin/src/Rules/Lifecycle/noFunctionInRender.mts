import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Avoid creating a new function on every render; declare a method with @bind, or move a per-item
 * handler into a child component.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself.
 */
export const noFunctionInRender: IRule = nativeRule(
    'carburetor/no-function-in-render',
    'Avoid creating a new function on every render; declare a method with @bind, or move a per-item handler into a child component.'
);
