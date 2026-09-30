/**
 * Engine-owned read views and persistent connection facades share one weak registry across
 * package copies and module formats. A read proxy maps to its raw target; a persistent
 * facade resolves its current native root when detached (it can retarget after setData).
 * A dropped view is never kept alive by the registry.
 *
 * Both roles must share a process-wide identity: a consumer from another copy can detach a
 * selection returned by this copy's tracked `read`, including a raw Map key alias. The
 * versioned sharedSingleton key deliberately does not promise a cross-version ABI.
 */
type TDynamicReadTarget = () => object | undefined;
export declare const liveViews: {
    /** Notes a diagnostic-only facade without erasing an existing target or resolver. */
    note: (view: object) => void;
    /**
     * Associates a tracked read view with its raw branch for graph detachment.
     *
     * @param view - a proxy minted by createReadProxy
     * @param target - its raw branch
     */
    noteReadTarget: (view: object, target: object) => void;
    /**
     * Registers a persistent facade's current-target resolver, not a stale snapshot of
     * its original root. Only engine-created facades receive one.
     *
     * @param view - persistent connection facade
     * @param resolve - reads the current supported native root and records its wildcard
     */
    noteDynamicReadTarget: (view: object, resolve: TDynamicReadTarget) => void;
    /**
     * The raw branch of a known tracked read view, if this is one.
     *
     * @param view - candidate tracked read proxy
     */
    readTarget: (view: object) => object | undefined;
    /** Whether `value` is a registered engine view rather than detached plain data. */
    has: (value: unknown) => boolean;
};
export {};
