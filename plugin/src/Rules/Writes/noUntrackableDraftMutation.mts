import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
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

interface IOptions {
    mutatingMethods?: readonly string[];
}

/**
 * Methods that change a value the tracking proxies cannot wrap.
 *
 * The list is the heuristic: without type information a rule cannot tell a `Map` from an object of
 * your own that happens to have a `set` method, so the names are configurable and the rule is a
 * warning rather than an error.
 */
const MUTATING_METHODS: readonly string[] = [
    'set',
    'add',
    'delete',
    'clear',
    'setTime',
    'setDate',
    'setMonth',
    'setFullYear',
    'setHours',
    'setMinutes',
    'setSeconds',
    'setMilliseconds',
];

/** The name of the draft parameter of an enclosing `this.update(...)`, if there is one. */
const getUpdateDraftName = (node: IAstNode): string | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'CallExpression' && getMemberCallName(current) === 'update') {
            const body: IAstNode | undefined = (current as ICallExpressionNode).arguments[0];
            const parameter: IAstNode | undefined = body && (body as IFunctionNode).params?.[0];

            return parameter && parameter.type === 'Identifier'
                ? (parameter as IIdentifierNode).name
                : undefined;
        }

        current = current.parent;
    }

    return undefined;
};

/**
 * Reports an in-place change to a value the engine cannot track, reached through `draft`.
 *
 * Tracking stops at `Map`, `Set`, `Date` and class instances: the proxy hands out the real object,
 * so the mutation happens behind its back. No update is lost over it — reaching for such a value
 * through `draft` is recorded as writing the path it came from — but the granularity stops there:
 * the whole value is invalidated whatever changed inside it, and the same mutation made through
 * `this.data` invalidates the entire store.
 *
 * Replacing the value keeps the usual precision, and plain data keeps all of it.
 *
 * See docs/hazards.md, H10.
 */
export const noUntrackableDraftMutation: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Replace an untrackable value instead of mutating it through draft.',
        },
        schema: ruleOptions.schema({
            mutatingMethods: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {carburetorBases} = ruleOptions.read(context);
        const methods: readonly string[] = (context.options[0] as IOptions)?.mutatingMethods
            || MUTATING_METHODS;

        return {
            CallExpression(node: IAstNode): void {
                const method = getMemberCallName(node);

                if (!method || !methods.includes(method)) {
                    return;
                }

                const callee = (node as ICallExpressionNode).callee as IMemberExpressionNode;
                const {base, baseProperty} = describeChainRoot(callee.object);

                const throughDraft = base.type === 'ThisExpression' && baseProperty === 'draft';
                const throughUpdateDraft = base.type === 'Identifier'
                    && (base as IIdentifierNode).name === getUpdateDraftName(node);

                if (!throughDraft && !throughUpdateDraft) {
                    return;
                }

                if (!findEnclosingClassExtending(node, carburetorBases)) {
                    return;
                }

                context.report({
                    node,
                    message: `${method}() changes a value the tracking proxies cannot wrap, so the `
                        + 'change itself is invisible and the whole value is invalidated instead of '
                        + 'the part that changed. Replace the value (draft.x = next) or keep plain '
                        + 'objects and arrays in the store.',
                });
            },
        };
    },
};
