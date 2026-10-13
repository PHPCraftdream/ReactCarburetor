import {IRenderAttempt} from "@/Carburetor/Component/Models/Connection";

/**
 * Returns configuration-free selection attribution.
 *
 * @param attempt - Current attempt, absent outside render.
 */
export const getSelectionAttemptIdentity = (attempt: IRenderAttempt | undefined): symbol | undefined => {
    if (attempt === undefined) return undefined;

    return attempt.selectionIdentity ??= Symbol();
};
