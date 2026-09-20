import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {findEnclosingClassMember} from "#src/Utils/Ast/Find/findEnclosingClassMember.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IClassMemberNode,
    IIdentifierNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

/** What the base class does in each of these is load-bearing, so skipping it breaks one thing. */
const LIFECYCLE_NAMES: readonly string[] = [
    'componentDidMount',
    'componentDidUpdate',
    'componentWillUnmount',
    'shouldComponentUpdate',
];

/** The gate has to return the base answer, not merely ask for it. */
const ANSWERING_NAMES: readonly string[] = ['shouldComponentUpdate'];

const identify = (node: IAstNode): string => `${node.start}:${node.end}`;

interface IOverride {
    node: IAstNode;
    name: string;
}

/** Whether a super call's value is kept — returned directly, or bound for a later return. */
const isResultUsed = (node: IAstNode): boolean => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'ReturnStatement' || current.type === 'VariableDeclarator') {
            return true;
        }

        if (current.type === 'MethodDefinition' || current.type === 'PropertyDefinition') {
            return false;
        }

        current = current.parent;
    }

    return false;
};

/**
 * Reports a lifecycle override that does not call its base implementation.
 *
 * The base class does the real work in all four: `componentDidMount` commits subscriptions and runs
 * effects, `componentDidUpdate` re-runs them, `componentWillUnmount` releases both, and
 * `shouldComponentUpdate` is the props gate. Skipping `super` disables exactly one of those, so the
 * component renders correctly on mount and then never updates, or leaks every subscription it makes.
 * Nothing is raised at any point.
 *
 * Overriding `useEffects` / `unUseEffects` instead avoids the question entirely.
 *
 * See docs/hazards.md, H12.
 */
export const requireSuperInLifecycle: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Call the base implementation when overriding a lifecycle method.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases} = ruleOptions.read(context);
        const overrides = new Map<string, IOverride>();
        const calls = new Set<string>();
        const answers = new Set<string>();

        return {
            MethodDefinition(node: IAstNode): void {
                const name = getPropertyKeyName((node as IClassMemberNode).key);

                if (!name || !LIFECYCLE_NAMES.includes(name)) {
                    return;
                }

                if (!findEnclosingClassExtending(node, componentBases)) {
                    return;
                }

                overrides.set(identify(node), {node, name});
            },

            CallExpression(node: IAstNode): void {
                const callee: IAstNode = (node as ICallExpressionNode).callee;

                if (callee.type !== 'MemberExpression') {
                    return;
                }

                const member = callee as IMemberExpressionNode;

                if (member.object.type !== 'Super' || member.property.type !== 'Identifier') {
                    return;
                }

                const owner = findEnclosingClassMember(node);

                if (!owner) {
                    return;
                }

                const called = (member.property as IIdentifierNode).name;

                // `super.somethingElse()` does not stand in for the method being overridden.
                if (called !== getPropertyKeyName((owner as IClassMemberNode).key)) {
                    return;
                }

                calls.add(identify(owner));

                if (isResultUsed(node)) {
                    answers.add(identify(owner));
                }
            },

            'Program:exit'(): void {
                overrides.forEach((override: IOverride, key: string): void => {
                    if (!calls.has(key)) {
                        context.report({
                            node: override.node,
                            message: `${override.name} is overridden without calling `
                                + `super.${override.name}(), which is where the base class commits `
                                + 'subscriptions, runs effects, releases them or gates a re-render. '
                                + 'One of those silently stops working. Call super, or override '
                                + 'useEffects/unUseEffects instead.',
                        });

                        return;
                    }

                    if (ANSWERING_NAMES.includes(override.name) && !answers.has(key)) {
                        context.report({
                            node: override.node,
                            message: `${override.name} calls super but discards its answer, so the `
                                + 'props gate no longer decides anything. Combine the two answers, '
                                + 'for example `return super.shouldComponentUpdate(p, s) || mine`.',
                        });
                    }
                });
            },
        };
    },
};
