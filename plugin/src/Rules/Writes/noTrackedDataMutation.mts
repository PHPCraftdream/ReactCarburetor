import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {findEnclosingFunction} from "#src/Utils/Ast/Find/findEnclosingFunction.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isWithin} from "#src/Utils/Ast/isWithin.mts";
import {visitMutations} from "#src/Utils/Ast/visitMutations.mts";
import type {
    IAstNode,
    IIdentifierNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    IVariableDeclaratorNode,
    TRuleVisitor,
} from "#src/Models.mts";

/** The names a `useCarburetor` result is bound to, including a destructured branch. */
const getBoundNames = (pattern: IAstNode): string[] => {
    if (pattern.type === 'Identifier') {
        return [(pattern as IIdentifierNode).name];
    }

    if (pattern.type !== 'ObjectPattern') {
        return [];
    }

    const properties: readonly IAstNode[] = (pattern as unknown as {properties: readonly IAstNode[]}).properties;

    return properties.flatMap((property: IAstNode): string[] => {
        const value: IAstNode | undefined = (property as unknown as {value?: IAstNode}).value;

        return value && value.type === 'Identifier' ? [(value as IIdentifierNode).name] : [];
    });
};

/**
 * Reports a write to data that came from `useCarburetor`.
 *
 * At runtime this throws — the read proxy forbids writes and the type is deeply read-only — so it
 * only becomes silent once a cast is involved, which is exactly what people reach for when the
 * compiler complains. Catching it in the linter keeps the cast from being written in the first
 * place.
 *
 * Unlike the escape rule, a destructured branch counts here: `const {items} = this.useCarburetor(s)`
 * still yields a proxy, and writing through `items` fails the same way.
 *
 * See docs/hazards.md, H9.
 */
export const noTrackedDataMutation: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Change state through a carburetor method, not through tracked data.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        /** Binding name -> the function it was read in, so a same-named local elsewhere is safe. */
        const tracked = new Map<string, IAstNode>();

        const mutations = visitMutations((target: IAstNode, node: IAstNode): void => {
            const {base} = describeChainRoot(target);

            if (base.type !== 'Identifier') {
                return;
            }

            const owner = tracked.get((base as IIdentifierNode).name);

            if (!owner || !isWithin(node, owner)) {
                return;
            }

            context.report({
                node,
                message: 'data read through useCarburetor is read-only: this write throws at '
                    + 'runtime, and silently does nothing once a cast hides it from the compiler. '
                    + 'Call a method on the carburetor, which writes through draft and knows which '
                    + 'paths changed.',
            });
        });

        return {
            ...mutations,

            VariableDeclarator(node: IAstNode): void {
                const declarator = node as IVariableDeclaratorNode;
                const init: IAstNode | null = declarator.init;

                if (!init || init.type !== 'CallExpression' || getMemberCallName(init) !== 'useCarburetor') {
                    return;
                }

                const callee = (init as unknown as {callee: IMemberExpressionNode}).callee;

                if (callee.object.type !== 'ThisExpression') {
                    return;
                }

                const scope = findEnclosingFunction(node);

                if (!scope) {
                    return;
                }

                getBoundNames(declarator.id).forEach((name: string): void => {
                    tracked.set(name, scope);
                });
            },
        };
    },
};
