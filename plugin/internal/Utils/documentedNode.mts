import type {IAstNode} from "#src/Models.mts";

/**
 * The node a declaration's doc comment sits above: its export wrapper, when it has one.
 *
 * In `export function foo() {}` the doc goes above `export`, so the comments directly before the
 * `FunctionDeclaration` are empty and a rule reading only those concludes the function is
 * undocumented — and misses a blank line that separates the doc from it.
 */
export const documentedNode = (node: IAstNode): IAstNode => {
    const parent = node.parent;

    if (!parent) {
        return node;
    }

    const exported = parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration';

    return exported ? parent : node;
};
