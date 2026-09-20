import {findEnclosingFunction} from "#src/Utils/Ast/Find/findEnclosingFunction.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isInsideRender} from "#src/Utils/Carburetor/isInsideRender.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAssignmentExpressionNode,
    IAstNode,
    IIdentifierNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    IVariableDeclaratorNode,
    TRuleVisitor,
} from "#src/Models.mts";

/**
 * Whether a node sits inside another's source range.
 *
 * Positions are the comparison because the host may hand out a fresh wrapper for the same node,
 * and because the rule tracks binding *names*: without a scope analyser, a same-named local in
 * another method would otherwise be mistaken for the tracked one.
 */
const isWithin = (node: IAstNode, container: IAstNode): boolean => {
    return node.start >= container.start && node.end <= container.end;
};

/** Whether the target of an assignment is a field of `this`. */
const isFieldOfThis = (target: IAstNode): boolean => {
    if (target.type !== 'MemberExpression') {
        return false;
    }

    return (target as IMemberExpressionNode).object.type === 'ThisExpression';
};

/**
 * Reports tracked data leaving the render that produced it.
 *
 * What `useCarburetor` returns is a proxy over the state as it is during that render. Read it
 * after the commit and nothing is tracked; read it after the branch it points at was replaced and
 * it may answer from data the store no longer holds. Both produce a plausible wrong value instead
 * of an error, which is why the escape is worth reporting even though many escapes are harmless:
 * a handler usually runs while its render is still the current one.
 *
 * Only a whole binding is tracked (`const data = this.useCarburetor(store)`). A destructured leaf
 * is usually a primitive and carries no proxy, so destructuring is left alone.
 *
 * See docs/hazards.md, H5.
 */
export const noEscapingTrackedData: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Use tracked data inside the render that read it.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);

        /** Name of a tracked binding -> the render function it was bound in. */
        const tracked = new Map<string, IAstNode>();

        const report = (node: IAstNode, detail: string): void => {
            context.report({
                node,
                message: `tracked data ${detail}. What useCarburetor returns is a proxy over the `
                    + 'state during this render: outside it nothing is tracked, and it may point at '
                    + 'a branch the store has since replaced. Read the values you need in render, or '
                    + 'call getData() where you need them.',
            });
        };

        return {
            VariableDeclarator(node: IAstNode): void {
                const declarator = node as IVariableDeclaratorNode;
                const init: IAstNode | null = declarator.init;

                if (!init || init.type !== 'CallExpression' || getMemberCallName(init) !== 'useCarburetor') {
                    return;
                }

                if (declarator.id.type !== 'Identifier') {
                    return;
                }

                if (!isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                const renderFunction = findEnclosingFunction(node);

                if (renderFunction) {
                    tracked.set((declarator.id as IIdentifierNode).name, renderFunction);
                }
            },

            AssignmentExpression(node: IAstNode): void {
                const assignment = node as IAssignmentExpressionNode;

                if (assignment.right.type !== 'Identifier') {
                    return;
                }

                if (!tracked.has((assignment.right as IIdentifierNode).name) || !isFieldOfThis(assignment.left)) {
                    return;
                }

                report(node, 'is stored on the component and outlives the render that read it');
            },

            Identifier(node: IAstNode): void {
                const owner = tracked.get((node as IIdentifierNode).name);

                if (!owner || (node.parent && node.parent.type === 'VariableDeclarator')) {
                    return;
                }

                // A same-named local elsewhere in the class is a different variable.
                if (!isWithin(node, owner)) {
                    return;
                }

                // A `map` callback still runs during the render, so it is not an escape.
                if (isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                report(node, 'is captured by a function that runs after this render');
            },
        };
    },
};
