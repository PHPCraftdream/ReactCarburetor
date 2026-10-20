/** Immutable description of one subscriber callback delivered by a store update. */
export interface IUpdateTrace {
    /** Subscriber identity, or its registered component display label. */
    readonly subscriber: string;
    /** Unique identifier of the store that delivered the callback. */
    readonly store: string;
    /** Changed paths that matched this subscriber's committed read set. */
    readonly paths: readonly string[];
    /** Latest store version represented by the delivery. */
    readonly version: number;
    /** Indicates the scheduler invoked the subscriber callback. */
    readonly callback: 'invoked';
}
