import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {visitMutations} from "#src/Utils/Ast/visitMutations.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

/**
 * Reports a store writing straight to `this.data`.
 *
 * It works — and quietly costs the whole point of the library. No path is recorded, so
 * `emitUpdate` cannot know what changed and falls back to invalidating everything: every
 * subscriber of the store re-renders. Nothing breaks, the app just gets slow in the way a
 * hooks-based one does, and the cause is invisible in a profiler trace.
 *
 * See docs/hazards.md, H7.
 */
export const noDirectDataWrite: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Write through draft, which records the changed paths.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {carburetorBases} = ruleOptions.read(context);

        return visitMutations((target: IAstNode, node: IAstNode): void => {
            const {base, baseProperty} = describeChainRoot(target);

            if (base.type !== 'ThisExpression' || baseProperty !== 'data') {
                return;
            }

            if (!findEnclosingClassExtending(node, carburetorBases)) {
                return;
            }

            context.report({
                node,
                message: 'writing to this.data records no path, so this update invalidates the '
                    + 'whole store and re-renders every subscriber instead of the ones that read '
                    + 'what changed. Write through this.draft, or this.update(draft => ...) to '
                    + 'mutate and publish in one step.',
            });
        });
    },
};
