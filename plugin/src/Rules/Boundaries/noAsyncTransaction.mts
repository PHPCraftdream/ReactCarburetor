import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep a transaction or update body synchronous.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H17.
 */
export const noAsyncTransaction: IRule = nativeRule(
    'carburetor/no-async-transaction',
    'Keep a transaction or update body synchronous.'
);
