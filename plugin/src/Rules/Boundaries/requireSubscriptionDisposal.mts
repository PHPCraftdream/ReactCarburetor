import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep a way to release a subscription, prefer watch(), which returns one.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H20.
 */
export const requireSubscriptionDisposal: IRule = nativeRule(
    'carburetor/require-subscription-disposal',
    'Keep a way to release a subscription, prefer watch(), which returns one.'
);
