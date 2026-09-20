import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IIdentifierNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

interface IOptions {
    storeConstructors?: readonly string[];
}

/** Recognises a store by the convention the library's own classes follow. */
const STORE_NAME_PATTERN = /Carburetor$/;

const SCOPE_TYPES: readonly string[] = [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ClassBody',
];

/** Whether the expression is evaluated once, when the module loads. */
const isModuleLevel = (node: IAstNode): boolean => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (SCOPE_TYPES.includes(current.type)) {
            return false;
        }

        current = current.parent;
    }

    return true;
};

/**
 * Reports a store created once per module in a project that renders on a server.
 *
 * On a server that instance is shared by every request in the process, so one user's state leaks
 * into another user's render. Locally, with one user, it behaves perfectly — this is the only
 * hazard in the catalogue whose symptom appears exclusively in production.
 *
 * Off by default, and deliberately so: a module-level store is the correct and recommended pattern
 * in a client-only application. A project that renders on a server turns it on and creates stores
 * through `CarburetorScope` instead, resolving them by token in `ScopedAntiHookComponent`.
 *
 * See docs/hazards.md, H18.
 */
export const noModuleLevelStore: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Create stores per request through a scope, not once per module.',
        },
        schema: ruleOptions.schema({
            storeConstructors: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {carburetorBases} = ruleOptions.read(context);
        const named: readonly string[] = (context.options[0] as IOptions)?.storeConstructors || [];

        /** Classes in this file that are stores, so a `new` of them is recognised by evidence. */
        const localStores = new Set<string>();
        const suspects: {node: IAstNode; name: string}[] = [];

        return {
            ClassDeclaration(node: IAstNode): void {
                const id: IAstNode | null = (node as unknown as {id: IAstNode | null}).id;

                if (!id || id.type !== 'Identifier') {
                    return;
                }

                // `findEnclosingClassExtending` starts from the parent, so ask about the body.
                const body: IAstNode = (node as unknown as {body: IAstNode}).body;

                if (findEnclosingClassExtending(body, carburetorBases)) {
                    localStores.add((id as IIdentifierNode).name);
                }
            },

            NewExpression(node: IAstNode): void {
                const callee: IAstNode = (node as unknown as {callee: IAstNode}).callee;

                if (callee.type !== 'Identifier') {
                    return;
                }

                // Inside a function or a class the instance is per call, which is the point.
                if (!isModuleLevel(node)) {
                    return;
                }

                suspects.push({node, name: (callee as IIdentifierNode).name});
            },

            'Program:exit'(): void {
                suspects.forEach((suspect: {node: IAstNode; name: string}): void => {
                    const isStore = localStores.has(suspect.name)
                        || named.includes(suspect.name)
                        || STORE_NAME_PATTERN.test(suspect.name);

                    if (!isStore) {
                        return;
                    }

                    context.report({
                        node: suspect.node,
                        message: `${suspect.name} is created once per module, so on a server every `
                            + 'request shares this instance and one user\'s state appears in another '
                            + 'user\'s render. Create it in a CarburetorScope per request and resolve '
                            + 'it by token.',
                    });
                });
            },
        };
    },
};
