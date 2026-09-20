import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IFunctionNode,
    IIdentifierNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

const COMPUTED_FACTORIES: readonly string[] = ['computed'];

/** The `computed(...)` call a node sits inside, if any. */
const findEnclosingComputedCall = (node: IAstNode): ICallExpressionNode | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'CallExpression') {
            const call = current as ICallExpressionNode;
            const callee = call.callee;

            if (callee.type === 'Identifier' && COMPUTED_FACTORIES.includes((callee as IIdentifierNode).name)) {
                return call;
            }
        }

        current = current.parent;
    }

    return undefined;
};

/** The name of the reader parameter the computed body was handed. */
const getReaderName = (call: ICallExpressionNode): string | undefined => {
    const body: IAstNode | undefined = call.arguments[0];

    if (!body) {
        return undefined;
    }

    const parameter: IAstNode | undefined = (body as IFunctionNode).params?.[0];

    return parameter && parameter.type === 'Identifier' ? (parameter as IIdentifierNode).name : undefined;
};

/** The object a member call was made on, when it is a plain identifier. */
const getCalleeObjectName = (node: IAstNode): string | undefined => {
    const callee: IAstNode = (node as ICallExpressionNode).callee;
    const object: IAstNode = (callee as IMemberExpressionNode).object;

    return object.type === 'Identifier' ? (object as IIdentifierNode).name : undefined;
};

/**
 * Reports a source read inside a `computed(...)` body without going through its reader.
 *
 * The body receives a `read` function, and that function is what registers dependencies. A direct
 * `get()` or `getData()` bypasses it, so the computed records no dependency on what it just read,
 * is never invalidated, and returns a stale value for the rest of the process's life. This was a
 * real bug in this engine's own history and is the most silent hazard in the catalogue: the value
 * is correct the first time and wrong forever after.
 *
 * A computed's `get()` takes no arguments, which keeps `Map.get(key)` out of the report.
 *
 * See docs/hazards.md, H3.
 */
export const noComputedGetInComputed: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Inside a computed, read sources through the reader it is given.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        return {
            CallExpression(node: IAstNode): void {
                const name = getMemberCallName(node);

                if (name !== 'get' && name !== 'getData') {
                    return;
                }

                if (name === 'get' && (node as ICallExpressionNode).arguments.length !== 0) {
                    return;
                }

                const computedCall = findEnclosingComputedCall(node);

                if (!computedCall) {
                    return;
                }

                // Reading through the reader is the correct form and must stay unreported.
                const objectName = getCalleeObjectName(node);

                if (objectName && objectName === getReaderName(computedCall)) {
                    return;
                }

                context.report({
                    node,
                    message: `${name}() inside a computed body bypasses the reader it was given, so `
                        + 'no dependency is registered and this computed will keep returning its '
                        + 'first value forever. Read through the reader instead: '
                        + 'computed(read => read(source)).',
                });
            },
        };
    },
};
