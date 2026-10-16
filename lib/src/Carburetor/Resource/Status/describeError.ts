/**
 * The message a rejection carries, for state that has to stay serializable.
 *
 * The raw rejection value is kept separately by whoever caught it: an `Error` instance cannot be
 * dehydrated for the client, and a devtools panel cannot show it either.
 */
export const describeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};
