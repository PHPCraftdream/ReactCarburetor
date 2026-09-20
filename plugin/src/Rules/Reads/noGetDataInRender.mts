import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isInsideRender} from "#src/Utils/Carburetor/isInsideRender.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

/**
 * Reports `getData()` called while a component renders.
 *
 * `getData()` returns the raw state and records nothing, so the component never subscribes: it
 * renders the right value once and then stays frozen. No error, no warning — just a number that
 * stops moving.
 *
 * Outside render `getData()` is the correct call, which is why this rule is scoped to the render
 * method itself and not to the class.
 *
 * See docs/hazards.md, H1.
 */
export const noGetDataInRender: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Read state in render through useCarburetor, not through getData().',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);

        return {
            CallExpression(node: IAstNode): void {
                if (getMemberCallName(node) !== 'getData') {
                    return;
                }

                if (!isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                context.report({
                    node,
                    message: 'getData() in render reads the state without subscribing to it, so '
                        + 'this component will never re-render when the data changes. Read through '
                        + 'this.useCarburetor(carburetor) instead, which subscribes to exactly the '
                        + 'fields you read.',
                });
            },
        };
    },
};
