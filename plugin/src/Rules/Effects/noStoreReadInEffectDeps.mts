import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Do not take an effect dependency from getData(); follow store data with useStoreEffect.
 *
 * Detection lives in the native crate (native/src/rules/effects/no_store_read_in_effect_deps.rs),
 * which the JS plugin calls once per lint run and reports through -- see
 * plugin/src/Utils/Native/nativeBridge.mts for why.
 */
export const noStoreReadInEffectDeps: IRule = nativeRule(
    'carburetor/no-store-read-in-effect-deps',
    'Do not take an effect dependency from getData(); follow store data with useStoreEffect.'
);
