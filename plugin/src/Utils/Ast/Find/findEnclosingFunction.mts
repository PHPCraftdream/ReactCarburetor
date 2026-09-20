import type {IAstNode} from "#src/Models.mts";

const FUNCTION_TYPES: readonly string[] = [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
];

/**
 * The function a node runs in.
 *
 * This is what separates code that executes during a render from code a render merely creates:
 * a call inside `onClick={() => store.getData()}` sits in a different function and runs later,
 * so a rule about render must stop at the first function boundary it meets.
 */
export const findEnclosingFunction = (node: IAstNode): IAstNode | undefined => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (FUNCTION_TYPES.includes(current.type)) {
            return current;
        }

        current = current.parent;
    }

    return undefined;
};
