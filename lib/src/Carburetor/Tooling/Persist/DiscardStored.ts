import {IStorageLike} from "../../Models/Tooling";
import {reportRemovalFailure} from "./ReportRemovalFailure";
import {reportRestoreFailure} from "./ReportRestoreFailure";

/** Reports a stored entry that could not be restored, then removes it from storage.
 *
 * The report comes first, so a handler sees the failure before any cleanup failure; a removal that
 * throws is reported through the same handler, or rethrown when there is none.
 *
 * @param storage - the adapter the entry lives in.
 * @param key - the storage key whose entry is discarded.
 * @param error - the thrown parse or restore failure.
 * @param onError - the caller's handler, absent when none was given.
 */
export const discardStored = (
    storage: IStorageLike,
    key: string,
    error: unknown,
    onError: ((error: unknown) => void) | undefined
): void => {
    reportRestoreFailure(key, error, onError, 'the stored data was removed');
    try {
        storage.removeItem(key);
    } catch (removeError: unknown) {
        reportRemovalFailure(onError, removeError);
    }
};
