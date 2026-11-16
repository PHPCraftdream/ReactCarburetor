import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep one render's component tree shallow so redraw boundaries stay visible.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H35. The `max` option
 * (`["warn", {"max": 4}]`) reaches the native run the same way the CLI's config file gives it.
 */
export const maxRenderDepth: IRule = nativeRule(
    'carburetor/max-render-depth',
    'Keep one render\'s component tree shallow; move the deeper part into a child component.',
    {schema: [{type: 'object'}], forwardOptions: true}
);
