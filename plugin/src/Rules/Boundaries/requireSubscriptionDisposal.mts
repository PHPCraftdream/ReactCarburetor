import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

/** Whether the subscription was given a stable id, which is a handle to release it by. */
const hasStableId = (node: IAstNode): boolean => {
    const options: IAstNode | undefined = (node as ICallExpressionNode).arguments[1];

    if (!options || options.type !== 'ObjectExpression') {
        return false;
    }

    const properties: readonly IAstNode[] =
        (options as unknown as {properties: readonly IAstNode[]}).properties;

    return properties.some((property: IAstNode): boolean => {
        if (property.type !== 'Property') {
            return false;
        }

        return getPropertyKeyName((property as unknown as {key: IAstNode}).key) === 'id';
    });
};

/**
 * Reports a subscription whose id is thrown away.
 *
 * The carburetor holds the callback, and the callback holds everything it closed over, for the
 * lifetime of the store. Nothing fails: memory grows and the callback keeps firing after the thing
 * it served is gone. `watch(paths, callback)` returns a disposer instead, which makes the cleanup
 * impossible to forget; components need neither, since `useCarburetor` subscribes and
 * `componentWillUnmount` releases.
 *
 * A subscription made with an explicit `{id}` is not reported: the caller kept a handle and can
 * release or replace it by that id, which is exactly how the engine subscribes components and
 * computed values.
 *
 * See docs/hazards.md, H20.
 */
export const requireSubscriptionDisposal: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Keep a way to release a subscription — prefer watch(), which returns one.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        return {
            CallExpression(node: IAstNode): void {
                if (getMemberCallName(node) !== 'subscribe') {
                    return;
                }

                // A kept return value is a handle; only a discarded one is unrecoverable.
                if (!node.parent || node.parent.type !== 'ExpressionStatement') {
                    return;
                }

                if (hasStableId(node)) {
                    return;
                }

                context.report({
                    node,
                    message: 'this subscription\'s id is discarded, so it can never be released: the '
                        + 'store keeps the callback, and everything it closed over, for the lifetime '
                        + 'of the process. Use watch(paths, callback), which returns a disposer, or '
                        + 'keep the id and unsubscribe.',
                });
            },
        };
    },
};
