import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import type {
    IAssignmentExpressionNode,
    IAstNode,
    ICallExpressionNode,
    IMemberExpressionNode,
    IOperatorNode,
    TRuleVisitor,
} from "#src/Models.mts";

/** Array methods that change the array they are called on rather than returning a new one. */
const ARRAY_MUTATORS: readonly string[] = [
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
];

/**
 * A visitor that reports every syntactic form of "this expression is being changed".
 *
 * Four forms count, and a rule that handles only assignment misses three of them: `x.y = v`,
 * `x.y++`, `delete x.y`, and an in-place array method. The handler receives the expression being
 * mutated and the node worth reporting on, and each rule decides whether that expression is one
 * it cares about.
 */
export const visitMutations = (
    onMutation: (target: IAstNode, node: IAstNode) => void
): TRuleVisitor => {
    return {
        AssignmentExpression(node: IAstNode): void {
            onMutation((node as IAssignmentExpressionNode).left, node);
        },

        UpdateExpression(node: IAstNode): void {
            onMutation((node as IOperatorNode).argument, node);
        },

        UnaryExpression(node: IAstNode): void {
            const unary = node as IOperatorNode;

            if (unary.operator === 'delete') {
                onMutation(unary.argument, node);
            }
        },

        CallExpression(node: IAstNode): void {
            const method = getMemberCallName(node);

            if (!method || !ARRAY_MUTATORS.includes(method)) {
                return;
            }

            const callee = (node as ICallExpressionNode).callee as IMemberExpressionNode;

            onMutation(callee.object, node);
        },
    };
};
