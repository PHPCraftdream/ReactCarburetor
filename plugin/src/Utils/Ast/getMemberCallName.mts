import type {IAstNode, ICallExpressionNode, IIdentifierNode, IMemberExpressionNode} from "#src/Models.mts";

/**
 * The method name in `something.name(...)`, or undefined when the call is not a member call or
 * the name is computed. A computed name is not knowable statically, and guessing would produce
 * reports a reader cannot verify.
 */
export const getMemberCallName = (node: IAstNode): string | undefined => {
    const callee: IAstNode = (node as ICallExpressionNode).callee;

    if (callee.type !== 'MemberExpression') {
        return undefined;
    }

    const member = callee as IMemberExpressionNode;

    if (member.computed || member.property.type !== 'Identifier') {
        return undefined;
    }

    return (member.property as IIdentifierNode).name;
};
