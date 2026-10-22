import {EResourceStatus} from '../../Models/Enums/EResourceStatus';

/** The four status flags derived from the authoritative `status`. */
export const resourceStatusFlags = (status: EResourceStatus): {
    isIdle: boolean; isPending: boolean; isSuccess: boolean; isError: boolean;
} => ({
    isIdle: status === EResourceStatus.Idle,
    isPending: status === EResourceStatus.Pending,
    isSuccess: status === EResourceStatus.Success,
    isError: status === EResourceStatus.Error,
});
