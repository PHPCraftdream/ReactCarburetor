import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceData} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';

/** The slot owns these fields through request publication and eventual settlement. */
const isRequestField = (field: PropertyKey): boolean =>
    field === 'status' || field === 'data' || field === 'error' || field === 'updatedAt';

/** Prepare a writable operational graph without changing a captured endpoint.
 *
 * @param state - current resource state.
 */
export const prepareSlotRequest = <T>(state: IResourceData<T>): IResourceData<T> | undefined => {
    const status = Object.getOwnPropertyDescriptor(state, 'status');
    const data = Object.getOwnPropertyDescriptor(state, 'data');
    const error = Object.getOwnPropertyDescriptor(state, 'error');
    const updatedAt = Object.getOwnPropertyDescriptor(state, 'updatedAt');
    if (status?.writable !== false && data?.writable !== false &&
        error?.writable !== false && updatedAt?.writable !== false &&
        (!status || 'value' in status) && (!data || 'value' in data) &&
        (!error || 'value' in error) && (!updatedAt || 'value' in updatedAt)) {
        return undefined;
    }
    return cloneOwnedGraph(state, undefined, (source, field, descriptor) => {
        if (source === state && isRequestField(field)) {
            descriptor.writable = true;
            if (field === 'status') descriptor.value = EResourceStatus.Pending;
            if (field === 'error') descriptor.value = undefined;
        }
        return descriptor;
    }, true);
};
