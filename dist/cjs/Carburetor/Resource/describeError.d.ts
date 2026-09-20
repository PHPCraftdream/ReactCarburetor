/**
 * The message a rejection carries, for state that has to stay serializable.
 *
 * The raw rejection value is kept separately by whoever caught it: an `Error` instance cannot be
 * dehydrated for the client, and a devtools panel cannot show it either.
 */
export declare const describeError: (error: unknown) => string;
