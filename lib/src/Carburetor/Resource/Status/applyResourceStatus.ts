import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceData} from '@/Carburetor/Models/Resource';

type TStatusFlag = 'isIdle' | 'isPending' | 'isSuccess' | 'isError';

const FLAG: Readonly<Record<EResourceStatus, TStatusFlag>> = {
    [EResourceStatus.Idle]: 'isIdle',
    [EResourceStatus.Pending]: 'isPending',
    [EResourceStatus.Success]: 'isSuccess',
    [EResourceStatus.Error]: 'isError',
};

/** Writes `status` and flips only the two flags that change; the flags already match the old status.
 *
 * @param target - resource state, usually a draft.
 * @param status - the new status.
 */
export const applyResourceStatus = <T>(target: IResourceData<T>, status: EResourceStatus): void => {
    const previous = target.status;
    if (previous === status) return;
    target.status = status;
    target[FLAG[previous]] = false;
    target[FLAG[status]] = true;
};
