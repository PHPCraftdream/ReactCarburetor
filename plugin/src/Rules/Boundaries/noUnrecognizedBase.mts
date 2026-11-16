import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Name an imported project base class in componentBases or storeBases, or no rule checks it.
 *
 * Detection lives in the native crate (native/src/rules/setup/no_unrecognized_base.rs), which the
 * JS plugin calls once per lint run and reports through -- see
 * plugin/src/Utils/Native/nativeBridge.mts for why.
 */
export const noUnrecognizedBase: IRule = nativeRule(
    'carburetor/no-unrecognized-base',
    'Name an imported project base class in componentBases or storeBases, or no rule checks it.'
);
