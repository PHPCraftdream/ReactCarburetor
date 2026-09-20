import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IIdentifierNode,
    IRule,
    IRuleContext,
    IVariableDeclaratorNode,
    TRuleVisitor,
} from "#src/Models.mts";

interface IAsyncNode extends IAstNode {
    async?: boolean;
    body?: IAstNode;
}

const FUNCTION_TYPES: readonly string[] = ['ArrowFunctionExpression', 'FunctionExpression'];

/** The call expression a function body hands back, when that is all it does. */
const getReturnedCall = (fn: IAstNode): IAstNode | undefined => {
    const body: IAstNode | undefined = (fn as IAsyncNode).body;

    if (!body) {
        return undefined;
    }

    if (body.type === 'CallExpression') {
        return body;
    }

    if (body.type !== 'BlockStatement') {
        return undefined;
    }

    const statements: readonly IAstNode[] = (body as unknown as {body: readonly IAstNode[]}).body;

    if (statements.length !== 1 || statements[0].type !== 'ReturnStatement') {
        return undefined;
    }

    const returned: IAstNode | null = (statements[0] as unknown as {argument: IAstNode | null}).argument;

    return returned && returned.type === 'CallExpression' ? returned : undefined;
};

/**
 * Reports an effect whose body is asynchronous.
 *
 * Whatever an effect returns is treated as its cleanup. An `async` function returns a promise,
 * which is not a function, so the cleanup is dropped: the effect can never tear itself down, and
 * the abort it was supposed to perform on unmount never happens. Nothing warns, because returning
 * nothing is legal too.
 *
 * The supported shape is a synchronous body that starts the work and returns a real cleanup, which
 * is usually an `AbortController` the cleanup aborts.
 *
 * See docs/hazards.md, H14.
 */
export const noAsyncEffect: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Keep an effect body synchronous so its cleanup survives.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        /** Names of async functions declared in this file, for the "returns a promise" case. */
        const asyncLocals = new Set<string>();
        const suspects: {node: IAstNode; callee: string}[] = [];

        const report = (node: IAstNode): void => {
            context.report({
                node,
                message: 'an async effect body returns a promise, and the engine treats what an '
                    + 'effect returns as its cleanup: the promise is not a function, so this effect '
                    + 'can never clean up after itself and nothing is aborted on unmount. Start the '
                    + 'work in a synchronous body and return a cleanup, for example one that aborts '
                    + 'an AbortController.',
            });
        };

        return {
            FunctionDeclaration(node: IAstNode): void {
                const id: IAstNode | null = (node as unknown as {id: IAstNode | null}).id;

                if ((node as IAsyncNode).async && id && id.type === 'Identifier') {
                    asyncLocals.add((id as IIdentifierNode).name);
                }
            },

            VariableDeclarator(node: IAstNode): void {
                const declarator = node as IVariableDeclaratorNode;
                const init: IAstNode | null = declarator.init;

                if (!init || !FUNCTION_TYPES.includes(init.type) || !(init as IAsyncNode).async) {
                    return;
                }

                if (declarator.id.type === 'Identifier') {
                    asyncLocals.add((declarator.id as IIdentifierNode).name);
                }
            },

            CallExpression(node: IAstNode): void {
                if (getMemberCallName(node) !== 'useEffect') {
                    return;
                }

                const body: IAstNode | undefined = (node as ICallExpressionNode).arguments[0];

                if (!body || !FUNCTION_TYPES.includes(body.type)) {
                    return;
                }

                if ((body as IAsyncNode).async) {
                    report(body);

                    return;
                }

                // `() => loadEverything()` where loadEverything is async: same promise, same loss.
                const returned = getReturnedCall(body);
                const callee: IAstNode | undefined = returned && (returned as ICallExpressionNode).callee;

                if (callee && callee.type === 'Identifier') {
                    suspects.push({node: body, callee: (callee as IIdentifierNode).name});
                }
            },

            'Program:exit'(): void {
                suspects.forEach((suspect: {node: IAstNode; callee: string}): void => {
                    if (asyncLocals.has(suspect.callee)) {
                        report(suspect.node);
                    }
                });
            },
        };
    },
};
