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

interface IOptions {
    storeNames?: readonly string[];
}

/** Calls that only read, and are therefore fine in render. */
const READ_METHODS: readonly string[] = [
    'getData',
    'getVersion',
    'getUID',
    'getLastError',
    'snapshot',
    'toJSON',
    'read',
    'get',
    // `suspend()` does write — it starts the request and marks the resource pending — but it is
    // built for exactly this position: the notification is deferred to a microtask precisely
    // because a render must not notify. Reporting it would flag the documented way to use Suspense.
    'suspend',
];

/** Reads that identify their argument as a store or a computed. */
const TRACKING_READS: readonly string[] = ['useCarburetor', 'useComputed'];

interface ISuspect {
    node: IAstNode;
    receiver: string;
    method: string;
}

/**
 * Reports a call that changes a store while a component renders.
 *
 * With the default scheduler the write notifies subscribers during the render. In the lucky case
 * that costs an extra pass; in the unlucky one React reports a maximum-update-depth error far from
 * the cause, or an abandoned concurrent render has already changed the state other components see.
 * Writes belong in `useEffects`, in a handler, or in a resource load.
 *
 * A store is identified by evidence rather than by a naming convention: whatever is passed to
 * `this.useCarburetor(...)` or `this.useComputed(...)` anywhere in the file is one, compared by the
 * source text of that argument so `this.props.carburetor` works as well as an imported singleton.
 * A component that writes to a store it never reads is not detected; `storeNames` covers it.
 *
 * See docs/hazards.md, H11.
 */
export const noStoreWriteInRender: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Do not change a store while rendering.',
        },
        schema: ruleOptions.schema({
            storeNames: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);
        const stores = new Set<string>((context.options[0] as IOptions)?.storeNames || []);
        const suspects: ISuspect[] = [];

        return {
            CallExpression(node: IAstNode): void {
                const method = getMemberCallName(node);

                if (!method) {
                    return;
                }

                const call = node as ICallExpressionNode;

                if (TRACKING_READS.includes(method)) {
                    const source: IAstNode | undefined = call.arguments[0];

                    if (source) {
                        stores.add(context.sourceCode.getText(source));
                    }

                    return;
                }

                if (READ_METHODS.includes(method)) {
                    return;
                }

                if (!isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                const receiver = (call.callee as IMemberExpressionNode).object;

                suspects.push({node, receiver: context.sourceCode.getText(receiver), method});
            },

            'Program:exit'(): void {
                suspects.forEach((suspect: ISuspect): void => {
                    if (!stores.has(suspect.receiver)) {
                        return;
                    }

                    context.report({
                        node: suspect.node,
                        message: `${suspect.method}() changes a store while this component renders, `
                            + 'which notifies subscribers mid-render: at best an extra pass, at worst '
                            + 'an update loop React reports far from here. Write from useEffects, '
                            + 'from an event handler, or from a resource load.',
                    });
                });
            },
        };
    },
};
