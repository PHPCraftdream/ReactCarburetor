import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Create stores per request through a scope, not once per module.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H18.
 */
export const noModuleLevelStore: IRule = nativeRule(
    'carburetor/no-module-level-store',
    'Create stores per request through a scope, not once per module.'
);
