import {findEnclosingFunction} from "#src/Utils/Ast/Find/findEnclosingFunction.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IIdentifierNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

interface IAsyncNode extends IAstNode {
    async?: boolean;
}

const FUNCTION_TYPES: readonly string[] = ['ArrowFunctionExpression', 'FunctionExpression'];

/** The name a batching call was made under, whether `transaction(...)` or `this.update(...)`. */
const getBatchingName = (node: IAstNode): string | undefined => {
    const callee: IAstNode = (node as ICallExpressionNode).callee;

    if (callee.type === 'Identifier' && (callee as IIdentifierNode).name === 'transaction') {
        return 'transaction';
    }

    return getMemberCallName(node) === 'update' ? 'update' : undefined;
};

/** The batching call a function was passed to as its body, if any. */
const getBatchingCallFor = (fn: IAstNode): {node: IAstNode; name: string} | undefined => {
    const call: IAstNode | null | undefined = fn.parent;

    if (!call || call.type !== 'CallExpression') {
        return undefined;
    }

    const first: IAstNode | undefined = (call as ICallExpressionNode).arguments[0];

    if (!first || first.start !== fn.start || first.end !== fn.end) {
        return undefined;
    }

    const name = getBatchingName(call);

    return name ? {node: call, name} : undefined;
};

/**
 * Reports an asynchronous body given to `transaction()` or `update()`.
 *
 * Both are open only while the body runs synchronously. At the first `await` the body returns a
 * promise, the batch closes, and every write after the await is delivered on its own — so the
 * batching silently does nothing, and in `update()`'s case the later writes are never published at
 * all. Development reports both at runtime; the rule catches the paths that never ran.
 *
 * The fix is always the same shape: do the asynchronous work first, then wrap the synchronous block
 * of writes.
 *
 * See docs/hazards.md, H17.
 */
export const noAsyncTransaction: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Keep a transaction or update body synchronous.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        const reported = new Set<string>();

        const report = (node: IAstNode, name: string): void => {
            const key = `${node.start}:${node.end}`;

            if (reported.has(key)) {
                return;
            }

            reported.add(key);

            context.report({
                node,
                message: `${name}() is open only while its body runs synchronously: at the first `
                    + 'await the body returns a promise and the batch closes, so the writes that '
                    + 'follow are delivered separately — or, for update(), never published at all. '
                    + `Do the asynchronous work first, then ${name}() the synchronous writes.`,
            });
        };

        return {
            CallExpression(node: IAstNode): void {
                const name = getBatchingName(node);
                const body: IAstNode | undefined = name
                    ? (node as ICallExpressionNode).arguments[0]
                    : undefined;

                if (!name || !body || !FUNCTION_TYPES.includes(body.type)) {
                    return;
                }

                if ((body as IAsyncNode).async) {
                    report(node, name);
                }
            },

            AwaitExpression(node: IAstNode): void {
                const fn = findEnclosingFunction(node);

                if (!fn) {
                    return;
                }

                // Only an await in the body itself closes the batch; one in a nested function
                // belongs to that function's own timeline.
                const batching = getBatchingCallFor(fn);

                if (batching) {
                    report(batching.node, batching.name);
                }
            },
        };
    },
};
