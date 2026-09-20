import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isInsideRender} from "#src/Utils/Carburetor/isInsideRender.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

const TRACKING_READS: readonly string[] = ['useCarburetor', 'useComputed'];

/** Whether the call was made on `this`, the only receiver these methods have. */
const isCalledOnThis = (node: IAstNode): boolean => {
    const callee: IAstNode = (node as ICallExpressionNode).callee;

    return (callee as IMemberExpressionNode).object.type === 'ThisExpression';
};

/**
 * Reports `useCarburetor` or `useComputed` called anywhere but render.
 *
 * Reads are collected into the tracking set of the render currently in progress, and the
 * carburetor copies that set when the component commits. A read from a handler, an effect or the
 * constructor therefore either does nothing at all or widens a subscription that the next render
 * throws away — non-deterministically, depending on when the code happened to run.
 *
 * In a handler, `getData()` is the right call: nothing there needs a subscription.
 *
 * See docs/hazards.md, H4.
 */
export const noUseCarburetorOutsideRender: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Call useCarburetor and useComputed in render only.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);

        return {
            CallExpression(node: IAstNode): void {
                const name = getMemberCallName(node);

                if (!name || !TRACKING_READS.includes(name) || !isCalledOnThis(node)) {
                    return;
                }

                if (isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                if (!findEnclosingClassExtending(node, componentBases)) {
                    return;
                }

                context.report({
                    node,
                    message: `this.${name}() outside render does not establish a subscription: reads `
                        + 'are collected per render and copied when the component commits, so this '
                        + 'one is either ignored or discarded by the next render. Read in render, '
                        + 'and use getData() where no subscription is wanted.',
                });
            },
        };
    },
};
