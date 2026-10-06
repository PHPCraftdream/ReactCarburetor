/** One step of a selection patch: the changed leaf itself, or the children whose subtrees changed. */
export interface IPatchNode {
    leaf: boolean;
    children: Map<string, IPatchNode> | undefined;
}

/**
 * The two fields of a connection that selection reuse reads and writes: its committed description
 * and the current render attempt's read record. A class component's connection satisfies it.
 */
export interface IReuseConnection {
    committed: {carburetor: object; baselineVersion: number; reads: ReadonlySet<string>} | undefined;
    attemptEntry: {source: object; reads: Set<string>; sharedReads?: boolean} | undefined;
}
