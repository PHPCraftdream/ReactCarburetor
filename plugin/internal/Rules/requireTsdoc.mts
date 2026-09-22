import type {
    IAstNode, ICommentNode, IIdentifierNode, ILiteralNode, IRule, IRuleContext, TRuleVisitor,
} from "#src/Models.mts";
import {documentedNode} from "#internal/Utils/documentedNode.mts";

interface IOptions {
    maxLines?: number;
    access?: 'all' | 'public';
    allowOverloads?: boolean;
    allowInheritdoc?: boolean;
    allowTrivialAccessors?: boolean;
    requireParamDocs?: boolean;
    requireFieldDocs?: boolean;
}

/**
 * A function-shaped node: the body an overload signature lacks, and the parameters the doc has to
 * cover.
 */
interface IFunctionLikeNode extends IAstNode {
    body: IAstNode | null;
    params: readonly IAstNode[];
}

/** A class member; `accessibility` is null unless the author wrote a modifier. */
interface IMemberNode extends IAstNode {
    key: IAstNode;
    value: IFunctionLikeNode | null;
    kind?: string;
    accessibility?: string | null;
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

/** A declaration with an optional name (a default-exported function has none). */
interface INamedNode extends IAstNode {
    id: IAstNode | null;
}

/** A literal key together with its written form, quotes included. */
interface IRawLiteralNode extends ILiteralNode {
    raw?: string;
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
 * The summary paragraph of a TSDoc block: decorations stripped, cut at the first tag line and at
 * the blank line that ends the summary.
 *
 * Only the summary is measured, because the rationale below it is the part this repository wants
 * written at length — "why, not what" produces paragraphs, and a limit on the whole comment would
 * be a limit on explaining anything.
 */
const summaryLines = (raw: string): string[] => {
    const lines: string[] = [];

    for (const line of raw.slice(3, -2).split('\n')) {
        const text = line.trim().replace(/^\*+/, '').trim();

        if (text.startsWith('@')) {
            break;
        }

        if (text === '') {
            // A blank line before any text is just the opening `/**` on its own line.
            if (lines.length > 0) {
                break;
            }

            continue;
        }

        lines.push(text);
    }

    return lines;
};

/** The `@param` tags of a TSDoc block: name plus description, continuation lines joined. */
interface IParamTag {
    name: string;
    description: string;
}

const paramTags = (raw: string): IParamTag[] => {
    const tags: IParamTag[] = [];
    let open: IParamTag | null = null;

    for (const line of raw.slice(3, -2).split('\n')) {
        const text = line.trim().replace(/^\*+/, '').trim();

        if (text.startsWith('@')) {
            const match = /^@param\s+(\S+)(?:\s+(.*))?$/.exec(text);

            open = match === null ? null : {name: match[1], description: (match[2] ?? '').replace(/^-\s*/, '')};

            if (open !== null) {
                tags.push(open);
            }

            continue;
        }

        // A prose line under a `@param` is that tag's description running over; any other tag
        // line closes it, which the branch above handles by reassigning `open`.
        if (open !== null && text !== '') {
            open.description += ` ${text}`;
        }
    }

    return tags;
};

/**
 * A parameter's written name, through the wrappers one can be written in (`...rest`, a default, a
 * constructor parameter property).
 */
const paramName = (node: IAstNode): string | null => {
    const shaped = node as {parameter?: IAstNode; argument?: IAstNode; left?: IAstNode};
    const inner = shaped.parameter ?? shaped.argument ?? shaped.left ?? node;

    return inner.type === 'Identifier' ? (inner as IIdentifierNode).name : null;
};

/**
 * Requires a TSDoc block on functions, class methods, function-valued properties and exported
 * `const` functions, and pushes back when the summary is empty or runs past `maxLines`.
 *
 * "Terse" is not mechanically checkable, so the rule settles for its shape: a `/**` block rather
 * than a `//` note or a plain `/*` wrapper, a summary that says something, and at most a few lines
 * of it. Only the summary counts — the rationale after the first blank line is the part this
 * repository wants at length, so limiting it would be limiting explanation itself. Overload
 * signatures, pure `@inheritdoc` comments, private members under `access: 'public'`, and trivial
 * accessors when `allowTrivialAccessors` is set, are excused. Each exemption returns before any
 * of the checks below, so an excused node also escapes the parameter and field checks.
 *
 * `requireParamDocs` asks every parameter of a covered function to carry its own `@param` tag
 * with a description that says something; `requireFieldDocs` asks a plain class field for the
 * same doc a function gets. A parameter written without a name — a destructured pattern — has
 * nothing a tag can be matched against and is skipped.
 *
 * A constructor parameter property — `constructor(protected data: T)` — declares its field
 * inside the parameter list, where no second comment position exists, so its documentation
 * cannot be split in two. The constructor's own `@param data` tag, the one `requireParamDocs`
 * already demands, counts as the field's doc too, and `requireFieldDocs` does not apply to it:
 * one declaration, one doc, at the only place a reader could look for it.
 *
 * A function with exactly one parameter is excused from the tag requirement, because
 * `@param value - the value` restates the signature, and this repository's comments exist for
 * what the signature cannot say. The exemption is exactly one parameter: add a second, and
 * every parameter needs its tag, position alone no longer telling a reader which is which. It
 * excuses a missing tag, not a broken one — a `@param` that is present must still carry a
 * description.
 */
export const requireTsdoc: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Requires a short TSDoc block on functions, methods and function-valued members.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    maxLines: {type: 'number'},
                    access: {type: 'string', enum: ['all', 'public']},
                    allowOverloads: {type: 'boolean'},
                    allowInheritdoc: {type: 'boolean'},
                    allowTrivialAccessors: {type: 'boolean'},
                    requireParamDocs: {type: 'boolean'},
                    requireFieldDocs: {type: 'boolean'},
                },
                additionalProperties: false,
            },
        ],
    },

    create(context: IRuleContext): TRuleVisitor {
        const options = (context.options[0] as IOptions) || {};

        const maxLines = options.maxLines ?? 3;
        const onlyPublic = (options.access ?? 'all') === 'public';
        const allowOverloads = options.allowOverloads ?? true;
        const allowInheritdoc = options.allowInheritdoc ?? true;
        const allowTrivialAccessors = options.allowTrivialAccessors ?? false;
        const requireParamDocs = options.requireParamDocs ?? false;
        const requireFieldDocs = options.requireFieldDocs ?? false;

        /**
         * Exemptions are decided before the missing-doc checks: an overload has no comment to
         * find, so it has to be excused before the rule would report one missing. The parameter
         * and field checks after them only run past the exemptions too.
         */
        const check = (
            node: IAstNode,
            kind: string,
            name: string,
            overload: boolean,
            member: IMemberNode | null,
            params: readonly IAstNode[],
        ): void => {
            // An exported declaration carries its doc above `export`, so the comments to read are
            // the ones before the export wrapper, not before the declaration inside it.
            const comments = context.sourceCode.getCommentsBefore(documentedNode(node));
            const comment: ICommentNode | null = comments.length > 0 ? comments[comments.length - 1] : null;
            const raw = comment === null ? '' : context.sourceCode.getText(comment);

            if (allowInheritdoc && raw.toLowerCase().includes('@inheritdoc')) {
                return;
            }

            if (overload && allowOverloads) {
                return;
            }

            const hidden = member !== null
                && (member.accessibility === 'private' || member.accessibility === 'protected');

            if (onlyPublic && hidden) {
                return;
            }

            if (allowTrivialAccessors && (member?.kind === 'get' || member?.kind === 'set')) {
                return;
            }

            if (comment === null) {
                context.report({
                    node,
                    message: `${kind} '${name}' is missing its TSDoc comment.`,
                });

                return;
            }

            if (comment.type === 'Line') {
                context.report({
                    node,
                    message: `${kind} '${name}' has a // comment where a /** */ TSDoc block is required.`,
                });

                return;
            }

            if (!raw.startsWith('/**')) {
                context.report({
                    node,
                    message: `${kind} '${name}' is documented with a plain /* */ block; TSDoc requires /** */.`,
                });

                return;
            }

            const lines = summaryLines(raw);

            if (lines.length === 0) {
                context.report({
                    node,
                    message: `The TSDoc on '${name}' has no description.`,
                });

                return;
            }

            if (lines.length > maxLines) {
                context.report({
                    node,
                    message: `The TSDoc summary on '${name}' is ${lines.length} lines; the maximum is ${maxLines}.`
                        + ' Keep the summary short and put the rest after a blank line.',
                });
            }

            if (requireParamDocs) {
                const tags = paramTags(raw);
                const tagged = new Set(tags.map((tag: IParamTag): string => tag.name));

                // The lone-parameter exemption: exactly one parameter, excused from needing a tag; a
                // broken tag that IS present is still reported below, so the exemption excuses
                // absence only.
                if (params.length !== 1) {
                    for (const param of params) {
                        const parameter = paramName(param);

                        if (parameter !== null && !tagged.has(parameter)) {
                            context.report({
                                node,
                                message: `The TSDoc on '${name}' is missing a @param tag for '${parameter}'.`,
                            });
                        }
                    }
                }

                for (const tag of tags) {
                    if (tag.description.trim() === '') {
                        context.report({
                            node,
                            message: `The @param tag for '${tag.name}' on '${name}' has no description.`,
                        });
                    }
                }
            }
        };

        /** The body of the function a member's value holds; null is what an overload member has. */
        const bodyOf = (value: IFunctionLikeNode | null): IAstNode | null => (value === null ? null : value.body);

        /** The parameters of the function a member's value holds; empty is what an overload member has. */
        const paramsOf = (value: IFunctionLikeNode | null): readonly IAstNode[] => (value === null ? [] : value.params);

        /** The declarator of an exported `const` whose initializer is a function, if any. */
        const exportedFunction = (node: IAstNode): IDeclaratorNode | undefined => {
            const declaration = (node as IExportNode).declaration;

            if (declaration === null || declaration.type !== 'VariableDeclaration') {
                return undefined;
            }

            const declared = (declaration as IVariableDeclarationNode).declarations;

            return declared.find((declarator: IDeclaratorNode): boolean => {
                const init = declarator.init;

                return declarator.id.type === 'Identifier' && init !== null
                    && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression');
            });
        };

        return {
            FunctionDeclaration: (node: IAstNode): void => {
                const fn = node as INamedNode & IFunctionLikeNode;

                check(node, 'Function', nameOf(fn.id) ?? 'function', fn.body === null, null, fn.params);
            },
            // An overload signature is its own node kind here, carrying no body.
            TSDeclareFunction: (node: IAstNode): void => {
                const fn = node as INamedNode & IFunctionLikeNode;

                check(node, 'Function', nameOf(fn.id) ?? 'function', fn.body === null, null, fn.params);
            },
            MethodDefinition: (node: IAstNode): void => {
                const member = node as IMemberNode;

                check(node, 'Method', nameOf(member.key) ?? 'method', bodyOf(member.value) === null, member,
                    paramsOf(member.value));
            },
            PropertyDefinition: (node: IAstNode): void => {
                const member = node as IMemberNode;
                const value = member.value;
                const holdsFunction = value !== null
                    && (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression');

                // A plain field has no body, yet is not an overload — hence the explicit flag.
                if (!holdsFunction) {
                    if (requireFieldDocs) {
                        check(node, 'Class property', nameOf(member.key) ?? 'property', false, member, []);
                    }

                    return;
                }

                check(node, 'Class property', nameOf(member.key) ?? 'property', false, member, value.params);
            },
            ExportNamedDeclaration: (node: IAstNode): void => {
                const fn = exportedFunction(node);

                if (fn !== undefined && fn.init !== null) {
                    check(node, 'Exported function', nameOf(fn.id) ?? 'function', false, null, fn.init.params);
                }
            },
        };
    },
};
