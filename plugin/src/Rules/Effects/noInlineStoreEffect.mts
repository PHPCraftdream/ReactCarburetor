import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Do not hand useStoreEffect a selector or effect built on every render.
 *
 * Detection lives in the native crate (native/src/rules/effects/no_inline_store_effect.rs),
 * which the JS plugin calls once per lint run and reports through -- see
 * plugin/src/Utils/Native/nativeBridge.mts for why.
 */
export const noInlineStoreEffect: IRule = nativeRule(
    'carburetor/no-inline-store-effect',
    'Do not hand useStoreEffect a selector or effect built on every render; it re-subscribes each time.'
);
