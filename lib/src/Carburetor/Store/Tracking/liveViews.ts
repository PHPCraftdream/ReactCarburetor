/**
 * The registry of live views the engine hands out: every read proxy built by createReadProxy
 * (the store root and each branch) and every persistent connect()/connectSelection() facade is
 * noted here at creation.
 *
 * `has` is what the child-prop snapshot boundary consults before handing data onward: a value
 * it answers true for is a live view, not detached data — a child reading it in its own render
 * does so outside the owning component's render attempt, the reads record nothing, and no
 * subscription covers what the child sees.
 *
 * Membership is a WeakSet: a view nothing references anymore costs nothing, and a replaced
 * data object is never kept alive by its former view. Internal to the engine — deliberately
 * absent from the package's public surface.
 */
const knownViews = new WeakSet<object>();

export const liveViews = {
    /** Notes `view` as a live view the engine handed out. */
    note: (view: object): void => {
        knownViews.add(view);
    },

    /** Whether `value` is one of the engine's live views rather than detached plain data. */
    has: (value: unknown): boolean => {
        return typeof value === 'object' && value !== null && knownViews.has(value);
    },
};
