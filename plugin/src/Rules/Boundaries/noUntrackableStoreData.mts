import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {isWithin} from "#src/Utils/Ast/isWithin.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IIdentifierNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

interface IOptions {
    allowedTypes?: readonly string[];
}

/** Values the tracking proxies pass through untouched. */
const UNTRACKABLE: readonly string[] = ['Map', 'Set', 'WeakMap', 'WeakSet', 'Date'];

/** The name a type reference or a constructor was written under. */
const getReferencedName = (node: IAstNode): string | undefined => {
    if (node.type === 'Identifier') {
        return (node as IIdentifierNode).name;
    }

    if (node.type !== 'TSTypeReference') {
        return undefined;
    }

    const typeName: IAstNode = (node as unknown as {typeName: IAstNode}).typeName;

    return typeName.type === 'Identifier' ? (typeName as IIdentifierNode).name : undefined;
};

/** The naming convention an initial-data factory follows, here and in the library itself. */
const FACTORY_NAME_PATTERN = /^(get|create|make)(Initial|Default)/;

/** Whether the expression is built by something that produces a store's starting state. */
const isInsideInitialData = (node: IAstNode): boolean => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'CallExpression') {
            const callee: IAstNode = (current as unknown as {callee: IAstNode}).callee;

            // `super({...})` inside a store constructor is initial data by definition.
            if (callee.type === 'Super') {
                return true;
            }
        }

        if (current.type === 'VariableDeclarator' || current.type === 'FunctionDeclaration') {
            const id: IAstNode | null = (current as unknown as {id: IAstNode | null}).id;
            const name = id && id.type === 'Identifier' ? (id as IIdentifierNode).name : undefined;

            if (name && FACTORY_NAME_PATTERN.test(name)) {
                return true;
            }
        }

        current = current.parent;
    }

    return false;
};

/**
 * Reports an untrackable value in a store's data.
 *
 * Tracking stops at `Map`, `Set`, `Date` and class instances. Reads of them are coarse — the whole
 * value is one leaf — an in-place change through `draft` invalidates that whole value, and the same
 * change through `this.data` invalidates the entire store. Everything keeps working, at a
 * granularity that quietly defeats the point of the library. `snapshot()` also shares these values
 * by reference instead of copying them, so undo does not restore them.
 *
 * Detection follows the declared shape: the interface a store is parameterised with
 * (`class X extends Carburetor<IData>`) and the initial-data object handed to its constructor.
 *
 * See docs/hazards.md, H19.
 */
export const noUntrackableStoreData: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Keep plain objects and arrays in a store; convert at the edges.',
        },
        schema: ruleOptions.schema({
            allowedTypes: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {carburetorBases} = ruleOptions.read(context);
        const allowed: readonly string[] = (context.options[0] as IOptions)?.allowedTypes || [];

        /** Names of the interfaces stores in this file are parameterised with. */
        const dataTypes = new Set<string>();
        const declarations = new Map<string, IAstNode>();
        const annotations: {node: IAstNode; name: string; owner: IAstNode}[] = [];
        const constructions: {node: IAstNode; name: string}[] = [];

        const isReportable = (name: string): boolean => {
            return UNTRACKABLE.includes(name) && !allowed.includes(name);
        };

        const report = (node: IAstNode, name: string): void => {
            context.report({
                node,
                message: `${name} is not tracked field by field: reading it is one coarse leaf, and `
                    + 'changing it in place is invisible to the proxies, so the whole value — or the '
                    + 'whole store — is invalidated instead of what changed. snapshot() shares it by '
                    + 'reference too, so undo will not restore it. Keep plain objects and arrays in '
                    + 'the store and convert at the edges.',
            });
        };

        return {
            ClassDeclaration(node: IAstNode): void {
                const body: IAstNode = (node as unknown as {body: IAstNode}).body;

                if (!findEnclosingClassExtending(body, carburetorBases)) {
                    return;
                }

                const args: IAstNode | null | undefined =
                    (node as unknown as {superTypeArguments?: IAstNode | null}).superTypeArguments;
                const params: readonly IAstNode[] =
                    (args as unknown as {params?: readonly IAstNode[]})?.params || [];
                const name = params[0] && getReferencedName(params[0]);

                if (name) {
                    dataTypes.add(name);
                }
            },

            TSInterfaceDeclaration(node: IAstNode): void {
                const id: IAstNode = (node as unknown as {id: IAstNode}).id;
                const name = id.type === 'Identifier' ? (id as IIdentifierNode).name : undefined;

                if (name) {
                    declarations.set(name, node);
                }
            },

            TSTypeReference(node: IAstNode): void {
                const name = getReferencedName(node);

                if (!name || !isReportable(name)) {
                    return;
                }

                const property = node.parent && node.parent.parent;

                // Only a field of an interface counts; a local variable's type is not store data.
                if (!property || property.type !== 'TSPropertySignature') {
                    return;
                }

                annotations.push({node, name, owner: property});
            },

            NewExpression(node: IAstNode): void {
                const callee: IAstNode = (node as unknown as {callee: IAstNode}).callee;
                const name = getReferencedName(callee);

                // Only a field of an object literal built by an initial-data factory: anywhere else
                // a Map is somebody's cache, not a store's state.
                if (!name || !isReportable(name) || !node.parent || node.parent.type !== 'Property') {
                    return;
                }

                if (!isInsideInitialData(node)) {
                    return;
                }

                constructions.push({node, name});
            },

            'Program:exit'(): void {
                const bodies: IAstNode[] = [];

                dataTypes.forEach((name: string): void => {
                    const declaration = declarations.get(name);

                    if (declaration) {
                        bodies.push(declaration);
                    }
                });

                annotations.forEach((annotation: {node: IAstNode; name: string; owner: IAstNode}): void => {
                    const inStoreData = bodies.some((body: IAstNode): boolean => {
                        return isWithin(annotation.owner, body);
                    });

                    if (inStoreData) {
                        report(annotation.node, annotation.name);
                    }
                });

                constructions.forEach((construction: {node: IAstNode; name: string}): void => {
                    report(construction.node, construction.name);
                });
            },
        };
    },
};
