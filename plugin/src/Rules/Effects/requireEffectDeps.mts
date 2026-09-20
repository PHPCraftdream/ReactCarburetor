import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isWithin} from "#src/Utils/Ast/isWithin.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

/** Only these two carry per-render values; a store is subscribed to, not depended on. */
const REACTIVE_ROOTS: readonly string[] = ['props', 'state'];

/**
 * Bodies whose reads a rule can actually see.
 *
 * `this.useEffect(this.props.carburetor.loadData, 'load', [])` passes a reference instead of an
 * inline function, and what that function reads is in another file. Reporting the reference itself
 * as a missing dependency would fire on a pattern this library recommends — passing a stable bound
 * method rather than building a closure every render — so a non-inline body is left alone.
 */
const ANALYSABLE_BODIES: readonly string[] = ['ArrowFunctionExpression', 'FunctionExpression'];

/** The `this.useEffect(...)` call a node sits inside, along with its parts. */
const findEnclosingEffect = (node: IAstNode): ICallExpressionNode | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'CallExpression' && getMemberCallName(current) === 'useEffect') {
            return current as ICallExpressionNode;
        }

        current = current.parent;
    }

    return undefined;
};

/**
 * Reports a prop or a piece of state read by an effect but missing from its dependencies.
 *
 * The effect then runs once with the first value and never again: the component re-renders with a
 * new prop while the effect keeps holding the old connection. It is the `exhaustive-deps` class of
 * bug without the hook, and it stays quiet because running once is also a legitimate intent.
 *
 * Deliberately conservative: only `this.props.x` and `this.state.x` are considered. A store read is
 * not a dependency — the component subscribes to it — and anything else would produce noise rather
 * than findings. A dependency covers every read below it, so `[this.props.user]` satisfies a read of
 * `this.props.user.name`.
 *
 * See docs/hazards.md, H16.
 */
export const requireEffectDeps: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'List the props and state an effect reads in its dependency array.',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        const dependenciesOf = (effect: ICallExpressionNode): string[] => {
            const deps: IAstNode | undefined = effect.arguments[2];

            if (!deps || deps.type !== 'ArrayExpression') {
                return [];
            }

            const elements: readonly (IAstNode | null)[] =
                (deps as unknown as {elements: readonly (IAstNode | null)[]}).elements;

            return elements.flatMap((element: IAstNode | null): string[] => {
                return element ? [context.sourceCode.getText(element)] : [];
            });
        };

        return {
            MemberExpression(node: IAstNode): void {
                const member = node as IMemberExpressionNode;

                // Report the whole chain once, from its outermost expression.
                if (node.parent && node.parent.type === 'MemberExpression'
                    && (node.parent as IMemberExpressionNode).object.start === node.start) {
                    return;
                }

                const {base, baseProperty} = describeChainRoot(member);

                if (base.type !== 'ThisExpression' || !baseProperty || !REACTIVE_ROOTS.includes(baseProperty)) {
                    return;
                }

                const effect = findEnclosingEffect(node);
                const body: IAstNode | undefined = effect && effect.arguments[0];

                // Reads in the dependency array itself are the declaration, not a dependency.
                if (!effect || !body || !isWithin(node, body)) {
                    return;
                }

                if (!ANALYSABLE_BODIES.includes(body.type)) {
                    return;
                }

                const text = context.sourceCode.getText(node);
                const covered = dependenciesOf(effect).some((dependency: string): boolean => {
                    return text === dependency || text.startsWith(`${dependency}.`);
                });

                if (covered) {
                    return;
                }

                context.report({
                    node,
                    message: `${text} is read by this effect but is not in its dependencies, so the `
                        + 'effect runs once with the first value and never again — it keeps whatever '
                        + 'it set up for the old one. Add it to the dependency array, or keep the '
                        + 'array empty deliberately and read the value some other way.',
                });
            },
        };
    },
};
