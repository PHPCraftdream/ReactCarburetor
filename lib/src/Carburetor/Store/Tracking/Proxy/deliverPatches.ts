import {TPatchRecorder} from '@/Carburetor/Models/Paths';

/** Deliver every already-applied patch, even when one observer rejects an earlier patch.
 *
 * @param listener - the current observer dispatcher.
 * @param patches - mutations whose effective paths are already attributed.
 */
export const deliverPatches = (
    listener: TPatchRecorder, patches: readonly Parameters<TPatchRecorder>[0][]
): void => {
    let failed = false;
    let firstError: unknown;
    for (const patch of patches) {
        try {
            listener(patch);
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }
    if (failed) throw firstError;
};
