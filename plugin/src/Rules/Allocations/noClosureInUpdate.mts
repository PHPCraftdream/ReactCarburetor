import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Pass `this.update` a callback that captures nothing; write to `this.draft` directly and call
 * `this.emitUpdate()` afterwards.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H32.
 */
export const noClosureInUpdate: IRule = nativeRule(
    'carburetor/no-closure-in-update',
    'Pass `this.update` a callback that captures nothing; write to `this.draft` directly and call `this.emitUpdate()` afterwards.'
);
