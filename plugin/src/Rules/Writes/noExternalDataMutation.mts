import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Change state through a store method, not through getData().
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H8.
 */
export const noExternalDataMutation: IRule = nativeRule(
    'carburetor/no-external-data-mutation',
    'Change state through a store method, not through getData().'
);
