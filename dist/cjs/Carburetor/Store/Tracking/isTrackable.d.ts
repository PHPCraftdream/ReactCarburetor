/** Only plain objects and arrays are worth wrapping — everything else is passed through. */
export declare const isTrackable: (value: unknown) => value is object;
