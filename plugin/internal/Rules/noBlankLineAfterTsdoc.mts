import type {
    IAstNode, IIdentifierNode, ILiteralNode, IRule, IRuleFixer, IRuleContext, TRuleVisitor,
} from "#src/Models.mts";
import {documentedNode} from "#internal/Utils/documentedNode.mts";

/** A function-shaped node, so a property can be told to hold a function. */
interface IFunctionLikeNode extends IAstNode {
    body: IAstNode | null;
}

/** A class member, named by its key. */
interface IMemberNode extends IAstNode {
    key: IAstNode;
    value: IFunctionLikeNode | null;
}

/** `const name = init`, one declarator of an export's variable declaration. */
interface IDeclaratorNode extends IAstNode {
    id: IAstNode;
    init: IFunctionLikeNode | null;
}

interface IVariableDeclarationNode extends IAstNode {
    type: 'VariableDeclaration';
    declarations: readonly IDeclaratorNode[];
}

/** `export const name = () => {}`, reached through its export wrapper. */
interface IExportNode extends IAstNode {
    declaration: IAstNode | null;
}

/** A declaration with an optional name (anonymous classes and default exports have none). */
interface INamedNode extends IAstNode {
    id: IAstNode | null;
}

/** A literal key together with its written form, quotes included. */
interface IRawLiteralNode extends ILiteralNode {
    raw?: string;
}

/** The gap between a TSDoc block and its declaration; the host requires `range` on report. */
interface IGapNode extends IAstNode {
    range: [number, number];
}

/** The written form of a name: an identifier's name, or a literal key exactly as written. */
const nameOf = (node: IAstNode | null): string | null => {
    if (node === null) {
        return null;
    }

    if (node.type === 'Identifier') {
        return (node as IIdentifierNode).name;
    }

    if (node.type === 'Literal') {
        return (node as IRawLiteralNode).raw ?? String((node as ILiteralNode).value);
    }

    return null;
};

/**
 * Reports a blank line between a TSDoc block and the declaration it documents, and fixes it away.
 *
 * The blank line makes the comment look like it belongs to whatever sits above it, while TSDoc
 * tooling binds the comment to the declaration below regardless — the gap only misleads readers.
 * The fix drops the empty lines and keeps the declaration's own indentation.
 */
export const noBlankLineAfterTsdoc: IRule = {
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        docs: {
            description: 'Disallows a blank line between a TSDoc block and the declaration it documents.',
        },
    },

    create(context: IRuleContext): TRuleVisitor {
        const text = context.sourceCode.getText();

        /** Reports when the last comment before the declaration is a TSDoc block split off by a blank line. */
        const check = (declaration: IAstNode, kind: string, name: string | null): void => {
            // The doc of an exported declaration sits above `export`, so the gap to measure ends
            // at the export wrapper rather than at the declaration inside it.
            const node = documentedNode(declaration);
            const comments = context.sourceCode.getCommentsBefore(node);

            if (comments.length === 0) {
                return;
            }

            const comment = comments[comments.length - 1];
            const raw = context.sourceCode.getText(comment);

            if (comment.type !== 'Block' || !raw.startsWith('/**')) {
                return;
            }

            const start = comment.end;
            const end = node.start;
            const gap = text.slice(start, end);

            if (!/\n[\t ]*\n/.test(gap)) {
                return;
            }

            // What follows the gap's last newline is the declaration's own indentation; keeping
            // it moves the declaration up under the comment instead of out of its column.
            const keep = gap.slice(gap.lastIndexOf('\n') + 1);
            const span: IGapNode = {type: comment.type, start, end, range: [start, end]};

            context.report({
                node: span,
                message: `A blank line separates the TSDoc comment from '${name ?? kind}'.`,
                fix: (fixer: IRuleFixer) => fixer.replaceText(span, `\n${keep}`),
            });
        };

        return {
            FunctionDeclaration: (node: IAstNode): void => {
                check(node, 'function', nameOf((node as INamedNode).id));
            },
            ClassDeclaration: (node: IAstNode): void => {
                check(node, 'class', nameOf((node as INamedNode).id));
            },
            MethodDefinition: (node: IAstNode): void => {
                check(node, 'method', nameOf((node as IMemberNode).key));
            },
            PropertyDefinition: (node: IAstNode): void => {
                const member = node as IMemberNode;
                const value = member.value;
                const holdsFunction = value !== null
                    && (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression');

                if (!holdsFunction) {
                    return;
                }

                check(node, 'class property', nameOf(member.key));
            },
            ExportNamedDeclaration: (node: IAstNode): void => {
                const declaration = (node as IExportNode).declaration;

                if (declaration === null || declaration.type !== 'VariableDeclaration') {
                    return;
                }

                const fn = (declaration as IVariableDeclarationNode).declarations.find(
                    (declarator: IDeclaratorNode): boolean => {
                        const init = declarator.init;

                        return declarator.id.type === 'Identifier' && init !== null
                            && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression');
                    },
                );

                if (fn !== undefined) {
                    check(node, 'exported function', nameOf(fn.id));
                }
            },
        };
    },
};
