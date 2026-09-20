import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {findEnclosingFunction} from "#src/Utils/Ast/Find/findEnclosingFunction.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import type {IAstNode, ICallExpressionNode, IClassMemberNode} from "#src/Models.mts";

const MEMBER_TYPES: readonly string[] = ['MethodDefinition', 'PropertyDefinition'];

/**
 * Methods that run their callback immediately, while the expression around them evaluates.
 *
 * Building a list of rows with `ids.map(id => ...)` happens during the render, so the callback is
 * render code; `onClick={() => ...}` and `useEffect(() => ...)` are not. Nothing in the syntax
 * distinguishes the two beyond who receives the function, so the synchronous receivers are named
 * here rather than guessed.
 */
const SYNCHRONOUS_CALLBACKS: readonly string[] = [
    'map',
    'flatMap',
    'filter',
    'forEach',
    'reduce',
    'reduceRight',
    'some',
    'every',
    'find',
    'findIndex',
    'findLast',
    'sort',
];

/** Whether a function is handed straight to one of those methods. */
const isSynchronousCallback = (fn: IAstNode): boolean => {
    const call: IAstNode | null | undefined = fn.parent;

    if (!call || call.type !== 'CallExpression') {
        return false;
    }

    const isArgument = (call as ICallExpressionNode).arguments.some((argument: IAstNode) => {
        return argument.start === fn.start && argument.end === fn.end;
    });

    if (!isArgument) {
        return false;
    }

    const method = getMemberCallName(call);

    return Boolean(method && SYNCHRONOUS_CALLBACKS.includes(method));
};

/**
 * Whether a node runs while a carburetor component renders.
 *
 * The question is not whether render encloses the node, but whether the node executes during the
 * render pass. A handler or an effect callback written in render runs after the commit, where
 * reading through `getData()` is correct — counting it as render would turn correct code into a
 * report. A `map` callback, on the other hand, is render code, and refusing to see that would
 * report the ordinary way of rendering a list.
 */
export const isInsideRender = (
    node: IAstNode,
    componentBases: readonly string[],
    renderMethods: readonly string[]
): boolean => {
    let current: IAstNode | null | undefined = node;

    while (current) {
        const enclosing = findEnclosingFunction(current);

        if (!enclosing) {
            return false;
        }

        const owner: IAstNode | null | undefined = enclosing.parent;

        if (owner && MEMBER_TYPES.includes(owner.type)) {
            const name = getPropertyKeyName((owner as IClassMemberNode).key);

            if (!name || !renderMethods.includes(name)) {
                return false;
            }

            return Boolean(findEnclosingClassExtending(owner, componentBases));
        }

        if (!isSynchronousCallback(enclosing)) {
            return false;
        }

        // The callback runs during the render; keep looking outward for the render method.
        current = enclosing.parent;
    }

    return false;
};
