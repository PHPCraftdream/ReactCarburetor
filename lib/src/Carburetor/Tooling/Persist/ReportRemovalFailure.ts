/** Reports a failed cleanup to onError, or rethrows when there is none — the read-path policy.
 *
 * @param onError - the caller's handler, absent when none was given.
 * @param error - the thrown removal failure.
 */
export const reportRemovalFailure = (onError: ((error: unknown) => void) | undefined, error: unknown): void => {
    if (onError) {
        onError(error);
    } else {
        throw error;
    }
};
