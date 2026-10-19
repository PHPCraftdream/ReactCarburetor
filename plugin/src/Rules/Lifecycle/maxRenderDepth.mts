import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep one render's component tree shallow so redraw boundaries stay visible.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H35. The `max` option is
 * applied by the native CLI's config file only: the bridge runs the binary with a neutral
 * configuration, so it always reports at the default depth of 3.
 */
export const maxRenderDepth: IRule = nativeRule(
    'carburetor/max-render-depth',
    'Keep one render\'s component tree shallow; move the deeper part into a child component.'
);
