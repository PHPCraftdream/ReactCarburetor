import type {IAstNode, IChainRoot, IIdentifierNode, IMemberExpressionNode} from "#src/Models.mts";

/**
 * Follows a member chain down to what it starts from.
 *
 * Every write rule needs the same answer: is this expression rooted at `this.draft`, at
 * `this.data`, at a `getData()` call, or at a local binding? Walking the chain in each rule would
 * repeat the same loop five times and get the computed-key case wrong in at least one of them.
 */
export const describeChainRoot = (expression: IAstNode): IChainRoot => {
    let current: IAstNode = expression;
    let baseProperty: string | undefined = undefined;

    while (current.type === 'MemberExpression') {
        const member = current as IMemberExpressionNode;

        baseProperty = !member.computed && member.property.type === 'Identifier'
            ? (member.property as IIdentifierNode).name
            : undefined;

        current = member.object;
    }

    return {base: current, baseProperty};
};
