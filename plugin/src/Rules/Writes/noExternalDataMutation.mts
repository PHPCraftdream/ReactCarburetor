import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {visitMutations} from "#src/Utils/Ast/visitMutations.mts";
import type {IAstNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

/**
 * Calls that hand out live state rather than a copy of it.
 *
 * `getEntry` returns a fresh view object, but the `data` inside it is the very object every reader of
 * that cache entry sees, so writing through it has the same consequences as writing through
 * `getData()`.
 */
const STATE_READERS: readonly string[] = ['getData', 'getEntry'];

/**
 * Reports a mutation of what `getData()` returned.
 *
 * `getData()` hands out the live state. Writing through it records no path *and* never reaches
 * `emitUpdate`, so the state and the screen disagree until something unrelated happens to wake the
 * same subscribers. Snapshots taken earlier drift too, because they share the object that was just
 * edited, which makes undo restore a state that never existed.
 *
 * State changes belong to the store that owns the state: add a method there and write through
 * `draft`.
 *
 * See docs/hazards.md, H8.
 */
export const noExternalDataMutation: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Change state through a store method, not through getData().',
        },
        schema: [],
    },

    create(context: IRuleContext): TRuleVisitor {
        return visitMutations((target: IAstNode, node: IAstNode): void => {
            const {base} = describeChainRoot(target);

            const reader = base.type === 'CallExpression' ? getMemberCallName(base) : undefined;

            if (!reader || !STATE_READERS.includes(reader)) {
                return;
            }

            context.report({
                node,
                message: `mutating what ${reader}() returned changes the state without recording a `
                    + 'path and without notifying anyone, so nothing re-renders and any snapshot '
                    + 'taken earlier silently changes with it. Add a method to the carburetor and '
                    + 'write through draft there.',
            });
        });
    },
};
