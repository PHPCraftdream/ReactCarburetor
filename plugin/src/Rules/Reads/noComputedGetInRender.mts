import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isInsideRender} from "#src/Utils/Carburetor/isInsideRender.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, ICallExpressionNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

/**
 * Reports a computed read with `get()` while a component renders.
 *
 * `get()` returns the memoized value and registers no subscription, so the component never hears
 * that the derived value changed — the same silent freeze as reading a store with `getData()`.
 *
 * A computed's `get()` takes no arguments, which is what tells it apart from `Map.get(key)`,
 * `FormData.get(name)` and every other `get` that needs a key. A zero-argument `get()` on
 * something that is not a computed is the rule's only false positive, and it is rare in render.
 *
 * See docs/hazards.md, H2.
 */
export const noComputedGetInRender: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Read a computed in render through useComputed, not through get().',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);

        return {
            CallExpression(node: IAstNode): void {
                if (getMemberCallName(node) !== 'get') {
                    return;
                }

                // A keyed lookup is somebody else's `get`, not a computed's.
                if ((node as ICallExpressionNode).arguments.length !== 0) {
                    return;
                }

                if (!isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                context.report({
                    node,
                    message: 'get() in render returns the derived value without subscribing to it, '
                        + 'so this component will not re-render when it changes. Use '
                        + 'this.useComputed(computed), which subscribes to the value rather than '
                        + 'to its inputs.',
                });
            },
        };
    },
};
