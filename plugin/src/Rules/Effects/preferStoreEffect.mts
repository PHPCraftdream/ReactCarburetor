import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Follow store data with useStoreEffect instead of a watch started by hand in an effect.
 *
 * Detection lives in the native crate (native/src/rules/effects/prefer_store_effect.rs),
 * which the JS plugin calls once per lint run and reports through -- see
 * plugin/src/Utils/Native/nativeBridge.mts for why.
 */
export const preferStoreEffect: IRule = nativeRule(
    'carburetor/prefer-store-effect',
    'Follow store data with useStoreEffect instead of a watch started by hand in an effect.'
);
