import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceData} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';

/** The slot owns these fields through request publication and eventual settlement. */
const isRequestField = (field: PropertyKey): boolean =>
    field === 'status' || field === 'data' || field === 'error' || field === 'updatedAt'
    || field === 'isIdle' || field === 'isPending' || field === 'isSuccess' || field === 'isError';

/** Whether a descriptor permits writing, or is absent. */
const isWritableFlag = (flag: PropertyDescriptor | undefined): boolean => flag?.writable !== false;

/** Prepare a writable operational graph without changing a captured endpoint.
 *
 * @param state - current resource state.
 */
export const prepareSlotRequest = <T>(state: IResourceData<T>): IResourceData<T> | undefined => {
    const status = Object.getOwnPropertyDescriptor(state, 'status');
    const data = Object.getOwnPropertyDescriptor(state, 'data');
    const error = Object.getOwnPropertyDescriptor(state, 'error');
    const updatedAt = Object.getOwnPropertyDescriptor(state, 'updatedAt');
    const flagDescriptors = ['isIdle', 'isPending', 'isSuccess', 'isError'].map(
        (field) => Object.getOwnPropertyDescriptor(state, field)
    );
    if (status?.writable !== false && data?.writable !== false &&
        error?.writable !== false && updatedAt?.writable !== false &&
        flagDescriptors.every(isWritableFlag) &&
        (!status || 'value' in status) && (!data || 'value' in data) &&
        (!error || 'value' in error) && (!updatedAt || 'value' in updatedAt)) {
        return undefined;
    }
    const flags = resourceStatusFlags(EResourceStatus.Pending);
    return cloneOwnedGraph(state, undefined, (source, field, descriptor) => {
        if (source === state && isRequestField(field)) {
            descriptor.writable = true;
            if (field === 'status') descriptor.value = EResourceStatus.Pending;
            else if (field === 'isIdle') descriptor.value = flags.isIdle;
            else if (field === 'isPending') descriptor.value = flags.isPending;
            else if (field === 'isSuccess') descriptor.value = flags.isSuccess;
            else if (field === 'isError') descriptor.value = flags.isError;
            if (field === 'error') descriptor.value = undefined;
        }
        return descriptor;
    }, 'operational');
};
