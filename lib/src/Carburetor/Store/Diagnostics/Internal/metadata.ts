/** Weakly held development metadata for component labels and warning deduplication. */
export const metadata = {
    /** Labels associated with component instances. */
    componentNames: new WeakMap<object, string>(),
    /** Labels associated with subscriber callbacks. */
    callbackNames: new WeakMap<object, string>(),
    /** Stores already warned for each component. */
    wideReadReported: new WeakMap<object, WeakSet<object>>(),
};
