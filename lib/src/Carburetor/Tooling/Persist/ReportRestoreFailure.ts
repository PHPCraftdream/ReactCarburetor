import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";

/** Reports a failed restore to onError, or loudly in development when the caller gave none.
 *
 * @param subject - the storage key whose stored entry was rejected.
 * @param error - the thrown parse or restore failure.
 * @param onError - the caller's handler, absent when none was given.
 * @param outcome - what happened to the stored data after the report.
 */
export const reportRestoreFailure = (
    subject: string,
    error: unknown,
    onError: ((error: unknown) => void) | undefined,
    outcome: string
): void => {
    if (onError) {
        onError(error);
        return;
    }
    if (IS_DEVELOPMENT) {
        diagnostics.report(
            'persist: stored entry "' + subject + '" could not be restored ('
            + (error instanceof Error ? error.message : String(error))
            + '); ' + outcome + '. Pass onError to handle restore failures yourself.'
        );
    }
};
