import type {IAstNode} from "#src/Models.mts";

/**
 * Whether a node sits inside another's source range.
 *
 * Positions are the comparison because the host may hand out a fresh wrapper object for the same
 * node, and because rules here track binding *names*: with no scope analyser available, a
 * same-named local in another method would otherwise be mistaken for the one being tracked.
 */
export const isWithin = (node: IAstNode, container: IAstNode): boolean => {
    return node.start >= container.start && node.end <= container.end;
};
