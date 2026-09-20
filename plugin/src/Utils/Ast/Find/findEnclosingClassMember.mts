import type {IAstNode} from "#src/Models.mts";

const MEMBER_TYPES: readonly string[] = ['MethodDefinition', 'PropertyDefinition'];

/**
 * The class member a node belongs to — a method, or a property holding a function.
 *
 * Rules that reason about a whole method, such as "this one writes but never publishes", need a
 * stable identity for it. The member node provides one: its source range is the method.
 */
export const findEnclosingClassMember = (node: IAstNode): IAstNode | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (MEMBER_TYPES.includes(current.type)) {
            return current;
        }

        current = current.parent;
    }

    return undefined;
};
