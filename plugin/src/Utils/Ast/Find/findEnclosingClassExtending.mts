import type {IAstNode, IIdentifierNode, IMemberExpressionNode} from "#src/Models.mts";

interface IClassNode extends IAstNode {
    superClass: IAstNode | null;
}

const CLASS_TYPES: readonly string[] = ['ClassDeclaration', 'ClassExpression'];

/** The name a base class is referenced by, whether written bare or through a namespace. */
const getSuperClassName = (superClass: IAstNode | null): string | undefined => {
    if (!superClass) {
        return undefined;
    }

    if (superClass.type === 'Identifier') {
        return (superClass as IIdentifierNode).name;
    }

    // `carburetor.AntiHookComponent` — the last segment is the one that names the base.
    if (superClass.type === 'MemberExpression') {
        const property = (superClass as IMemberExpressionNode).property;

        return property.type === 'Identifier' ? (property as IIdentifierNode).name : undefined;
    }

    return undefined;
};

/**
 * Walks up to the class a node sits in and answers whether it extends one of `baseNames`.
 *
 * Recognising a carburetor class by its `extends` clause is the only option available: JS
 * plugins get no type information, so a rule cannot ask what a base class actually is. The
 * consequence is deliberate and documented — a component that extends a project-local
 * subclass of `AntiHookComponent` is not recognised unless that name is configured.
 */
export const findEnclosingClassExtending = (
    node: IAstNode,
    baseNames: readonly string[]
): IAstNode | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (CLASS_TYPES.includes(current.type)) {
            const name = getSuperClassName((current as IClassNode).superClass);

            return name && baseNames.includes(name) ? current : undefined;
        }

        current = current.parent;
    }

    return undefined;
};
