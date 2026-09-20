import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    ILiteralNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

/**
 * Reports two effects registered under the same name in one component.
 *
 * The name is the effect's identity: its dependency array and its cleanup are stored under it. A
 * second registration overwrites the first one's record, so the first effect's cleanup is lost and
 * the deps comparison starts answering for the second. The symptom is a listener that is never
 * removed, which surfaces much later as a leak.
 *
 * See docs/hazards.md, H15.
 */
export const noDuplicateEffectName: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Give every effect in a component a name of its own.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases} = ruleOptions.read(context);
        const seen = new Set<string>();

        return {
            CallExpression(node: IAstNode): void {
                if (getMemberCallName(node) !== 'useEffect') {
                    return;
                }

                const name: IAstNode | undefined = (node as ICallExpressionNode).arguments[1];

                // A name built at runtime cannot be compared, so it is left alone.
                if (!name || name.type !== 'Literal' || typeof (name as ILiteralNode).value !== 'string') {
                    return;
                }

                const owner = findEnclosingClassExtending(node, componentBases);

                if (!owner) {
                    return;
                }

                const key = `${owner.start}:${owner.end}:${(name as ILiteralNode).value as string}`;

                if (!seen.has(key)) {
                    seen.add(key);

                    return;
                }

                context.report({
                    node: name,
                    message: `two effects in this component are registered as `
                        + `"${(name as ILiteralNode).value as string}". The name is the effect's `
                        + 'identity, so the second registration overwrites the first: its cleanup is '
                        + 'lost and never runs. Give each effect its own name.',
                });
            },
        };
    },
};
