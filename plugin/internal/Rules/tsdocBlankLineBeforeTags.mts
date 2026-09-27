import type {ICommentNode, IRule, IRuleContext, IRuleFixer, TRuleVisitor} from "#src/Models.mts";

/** A block tag at the start of a TSDoc line: `@param`, `@returns`, `@see`… */
const BLOCK_TAG = /^@[A-Za-z]/;

/** A Markdown code fence, inside which a line starting with `@` is code, not a tag. */
const FENCE = /^(```|~~~)/;

/**
 * What a TSDoc line says once its decoration is gone: the leading `/**` or `*` and one space.
 *
 * @param line - one physical line of the comment
 */
const contentOf = (line: string): string => {
    return line.replace(/^\s*\/\*\*/, '').replace(/^\s*\*(?!\/)/, '').replace(/\*\/\s*$/, '').trim();
};

/**
 * Where the description ends and the first block tag starts, when the comment has both.
 *
 * @param lines - the comment's physical lines, `/**` line first
 */
const findSections = (lines: readonly string[]): {lastDescription: number; firstTag: number} | null => {
    let inFence = false;
    let lastDescription = -1;

    for (let index = 0; index < lines.length; index++) {
        const content = contentOf(lines[index]);

        if (FENCE.test(content)) {
            inFence = !inFence;
        }

        if (!inFence && BLOCK_TAG.test(content)) {
            return lastDescription === -1 ? null : {lastDescription, firstTag: index};
        }

        if (content !== '') {
            lastDescription = index;
        }
    }

    return null;
};

/**
 * Requires exactly one blank line between a TSDoc description and its first block tag, and fixes
 * any other count to one.
 *
 * The blank line is what separates the prose a reader skims from the reference list below it; a
 * doc with none runs the two together, and a doc with several leaves a hole that looks like a
 * forgotten paragraph. The fix keeps the tag line's own `*` column for the inserted line.
 */
export const tsdocBlankLineBeforeTags: IRule = {
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        docs: {
            description: 'Requires exactly one blank line between a TSDoc description and its block tags.',
        },
    },

    create(context: IRuleContext): TRuleVisitor {
        /** Checks one comment, reporting and fixing a missing or doubled blank line. */
        const check = (comment: ICommentNode): void => {
            const raw = context.sourceCode.getText(comment);

            if (comment.type !== 'Block' || !raw.startsWith('/**')) {
                return;
            }

            const lines = raw.split('\n');
            const sections = findSections(lines);

            if (sections === null) {
                return;
            }

            const {lastDescription, firstTag} = sections;
            const blanks = firstTag - lastDescription - 1;

            if (blanks === 1) {
                return;
            }

            const star = lines[firstTag].indexOf('*');
            const blankLine = lines[firstTag].slice(0, star + 1);
            const fixed = [
                ...lines.slice(0, lastDescription + 1),
                blankLine,
                ...lines.slice(firstTag),
            ].join('\n');

            context.report({
                node: comment,
                message: blanks === 0
                    ? 'Add one blank line between the TSDoc description and its first tag.'
                    : `Keep exactly one blank line between the TSDoc description and its first tag, not ${blanks}.`,
                fix: (fixer: IRuleFixer) => fixer.replaceText(comment, fixed),
            });
        };

        return {
            Program: (): void => {
                context.sourceCode.getAllComments().forEach(check);
            },
        };
    },
};
