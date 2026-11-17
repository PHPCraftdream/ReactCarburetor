import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Keep render() short: past the configured number of lines (30 by default), move its parts into
 * methods of the component.
 *
 * Detection lives in the native crate (native/src/rules/lifecycle/max_render_lines.rs). The `max`
 * option (`["warn", {"max": 40}]`) reaches the native run the same way the CLI's config file gives
 * it.
 */
export const maxRenderLines: IRule = nativeRule(
    'carburetor/max-render-lines',
    'Keep render() short; move its parts into methods of the component.',
    {schema: [{type: 'object'}], forwardOptions: true}
);
