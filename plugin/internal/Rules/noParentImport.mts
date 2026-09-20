import type {IAstNode, ILiteralNode, IRule, IRuleContext, IRuleFixer, TRuleVisitor} from "#src/Models.mts";

interface IOptions {
    roots?: readonly {path: string; prefix: string}[];
}

interface ISourcedNode extends IAstNode {
    source: IAstNode | null;
}

/** Where the source trees start, and the alias each one is reached through. */
const DEFAULT_ROOTS: readonly {path: string; prefix: string}[] = [
    {path: 'lib/src', prefix: '@/'},
    {path: 'plugin/src', prefix: '@plugin/'},
];

/** Resolves a relative specifier against the importing file, in posix form. */
const resolveFrom = (filename: string, specifier: string): string => {
    const segments = filename.replace(/\\/g, '/').split('/');

    segments.pop();

    specifier.split('/').forEach((part: string): void => {
        if (part === '..') {
            segments.pop();

            return;
        }

        if (part !== '.') {
            segments.push(part);
        }
    });

    return segments.join('/');
};

/** The aliased form of a resolved path, when it lands inside one of the source roots. */
const toAlias = (resolved: string, roots: readonly {path: string; prefix: string}[]): string | undefined => {
    for (const root of roots) {
        const marker = new RegExp(`(?:^|/)${root.path}/`);
        const match = marker.exec(resolved);

        if (match) {
            return root.prefix + resolved.slice(match.index + match[0].length);
        }
    }

    return undefined;
};

/**
 * Reports an import that reaches up out of its directory, and rewrites it to the alias.
 *
 * `../../Models/Paths` tells a reader nothing about where the module lives and changes meaning when
 * the file moves; `@/Carburetor/Models/Paths` is the same module named from the root of the source
 * tree. Sideways and downward imports (`./x`, `./sub/x`) stay relative, because there the relative
 * path *is* the information.
 *
 * The fix is part of the rule on purpose: a one-off script that rewrote these once would have to be
 * written again the next time, and would not run on code that has not been committed yet.
 *
 * An import that leaves the source tree entirely — a benchmark reaching into `dist`, say — has no
 * aliased form, so it is left alone rather than reported with no way forward.
 */
export const noParentImport: IRule = {
    meta: {
        type: 'problem',
        fixable: 'code',
        docs: {
            description: 'Import through the alias instead of reaching up out of the directory.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    roots: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: {type: 'string'},
                                prefix: {type: 'string'},
                            },
                            required: ['path', 'prefix'],
                            additionalProperties: false,
                        },
                    },
                },
                additionalProperties: false,
            },
        ],
    },

    create(context: IRuleContext): TRuleVisitor {
        const roots = (context.options[0] as IOptions)?.roots || DEFAULT_ROOTS;

        const check = (node: IAstNode): void => {
            const source: IAstNode | null = (node as ISourcedNode).source;

            if (!source || source.type !== 'Literal') {
                return;
            }

            const specifier: unknown = (source as ILiteralNode).value;

            if (typeof specifier !== 'string' || !specifier.startsWith('../')) {
                return;
            }

            const alias = toAlias(resolveFrom(context.filename, specifier), roots);

            if (!alias) {
                return;
            }

            context.report({
                node: source,
                message: `"${specifier}" reaches up out of this directory. Import it as "${alias}", `
                    + 'which names the module from the root of the source tree and survives the file '
                    + 'being moved.',
                fix: (fixer: IRuleFixer) => fixer.replaceText(source, `"${alias}"`),
            });
        };

        return {
            ImportDeclaration: check,
            ExportNamedDeclaration: check,
            ExportAllDeclaration: check,
        };
    },
};
