import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IClassMemberNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

const LIFECYCLE_NAMES: readonly string[] = [
    'render',
    'componentDidMount',
    'componentDidUpdate',
    'componentWillUnmount',
    'shouldComponentUpdate',
    'componentDidCatch',
    'getSnapshotBeforeUpdate',
];

/**
 * Reports a lifecycle method declared as a class property.
 *
 * A class field is installed on the instance and shadows the prototype method for good, so
 * the base implementation React would have called is gone: `AntiHookComponent` commits
 * subscriptions in `componentDidMount`, re-runs effects in `componentDidUpdate`, releases
 * both in `componentWillUnmount` and gates re-renders in `shouldComponentUpdate`. In an
 * earlier version of this library exactly this silently disabled every effect in a component,
 * and nothing about the code looked wrong.
 *
 * See docs/hazards.md, H13.
 */
export const noLifecycleClassProperty: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Declare lifecycle methods as methods, not as class properties.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases} = ruleOptions.read(context);

        return {
            PropertyDefinition(node: IAstNode): void {
                const property = node as IClassMemberNode;
                const name = getPropertyKeyName(property.key);

                if (!name || !LIFECYCLE_NAMES.includes(name) || property.static) {
                    return;
                }

                if (!findEnclosingClassExtending(node, componentBases)) {
                    return;
                }

                context.report({
                    node,
                    message: `"${name}" is declared as a class property, which shadows the base `
                        + 'implementation on the prototype: effects, subscription cleanup or the '
                        + 'props gate will silently stop working. Declare it as a method and call '
                        + 'super, or override useEffects/unUseEffects instead.',
                });
            },
        };
    },
};
