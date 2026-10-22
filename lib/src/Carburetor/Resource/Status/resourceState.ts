import {EResourceStatus} from '../../Models/Enums/EResourceStatus';
import {resourceStatusFlags} from './resourceStatusFlags';

/** The two derived views users otherwise hand-assemble: `isLoading` before the first data
 * lands, `refreshFailed` on a failed refresh.
 *
 * @param status - the resource status the derived flags are computed from.
 * @param data - the settled answer, or undefined while no answer exists.
 * @param error - the settled error message, if any.
 */
export const resourceState = (
    status: EResourceStatus, data?: unknown, error?: string,
): {
    isIdle: boolean; isPending: boolean; isSuccess: boolean; isError: boolean;
    isLoading: boolean; refreshFailed: boolean;
} => {
    const flags = resourceStatusFlags(status);
    return {
        ...flags,
        // "Loading" covers the absent entry (Idle) readers see before the first load lands.
        isLoading: flags.isIdle || flags.isPending ? data === undefined : false,
        refreshFailed: flags.isSuccess && error !== undefined,
    };
};
