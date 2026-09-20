import type {IAstNode, IIdentifierNode, ILiteralNode} from "#src/Models.mts";

/**
 * The name a class member is declared under, or undefined when it cannot be known
 * statically. A computed key built at runtime (`[name]() {}`) has no name a rule can
 * reason about, and reporting on a guess would be worse than staying quiet.
 */
export const getPropertyKeyName = (key: IAstNode | null | undefined): string | undefined => {
    if (!key) {
        return undefined;
    }

    if (key.type === 'Identifier') {
        return (key as IIdentifierNode).name;
    }

    if (key.type === 'Literal') {
        const value: unknown = (key as ILiteralNode).value;

        return typeof value === 'string' ? value : undefined;
    }

    return undefined;
};
