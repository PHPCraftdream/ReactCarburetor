import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Change state through a carburetor method, not through tracked data.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H9.
 */
export const noTrackedDataMutation: IRule = nativeRule(
    'carburetor/no-tracked-data-mutation',
    'Change state through a carburetor method, not through tracked data.'
);
