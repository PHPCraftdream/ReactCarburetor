import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Read state in render through useCarburetor, not through getData().
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H1.
 */
export const noGetDataInRender: IRule = nativeRule(
    'carburetor/no-get-data-in-render',
    'Read state in render through useCarburetor, not through getData().'
);
