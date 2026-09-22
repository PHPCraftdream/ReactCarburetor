export declare const liveViews: {
    /** Notes `view` as a live view the engine handed out. */
    note: (view: object) => void;
    /** Whether `value` is one of the engine's live views rather than detached plain data. */
    has: (value: unknown) => boolean;
};
