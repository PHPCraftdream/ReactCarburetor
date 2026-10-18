import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData} from "@/Carburetor/Models/Resource";
import {cloneOwnedGraph} from "@/Carburetor/Store/Utils/Graph/cloneOwnedGraph";
import {resourceStatusFlags} from "@/Carburetor/Resource/Status/resourceStatusFlags";

/** Fields a slot publication owns; the same set a request or memory hit settles. */
const isPublishField = (field: PropertyKey): boolean =>
    field === 'status' || field === 'data' || field === 'error' || field === 'updatedAt'
    || field === 'isIdle' || field === 'isPending' || field === 'isSuccess' || field === 'isError';

/** Whether a descriptor accepts writes: an absent or writable value descriptor does. */
const isWritableDescriptor = (descriptor: PropertyDescriptor | undefined): boolean =>
    descriptor === undefined || ('value' in descriptor && descriptor.writable !== false);

interface ISlotPublication<T> {
    status: EResourceStatus;
    data: T | undefined;
    error: string | undefined;
    updatedAt: number | undefined;
}

/** Prepare an owned writable graph for a publication, or undefined when the state is writable.
 *
 * @param state - The graph the publication is about to be written into.
 * @param publication - The status, data, error and timestamp to bake into the owned copy.
 */
export const prepareSlotPublication = <T>(
    state: IResourceData<T>, publication: ISlotPublication<T>,
): IResourceData<T> | undefined => {
    const fields = ['status', 'data', 'error', 'updatedAt',
        'isIdle', 'isPending', 'isSuccess', 'isError'] as const;
    // cloneOwnedGraph throws for accessors on plain objects, so an accessor state falls back to the legacy draft path.
    if (fields.some((field) => {
        const descriptor = Object.getOwnPropertyDescriptor(state, field);
        return descriptor !== undefined && !('value' in descriptor);
    })) return undefined;
    const writable = fields.every((field) => isWritableDescriptor(Object.getOwnPropertyDescriptor(state, field)));
    if (writable) return undefined;

    const flags = resourceStatusFlags(publication.status);
    return cloneOwnedGraph(state, undefined, (source, field, descriptor) => {
        if (source === state && isPublishField(field)) {
            descriptor.writable = true;
            if (field === 'status') descriptor.value = publication.status;
            else if (field === 'data') descriptor.value = publication.data;
            else if (field === 'error') descriptor.value = publication.error;
            else if (field === 'updatedAt') descriptor.value = publication.updatedAt;
            else if (field === 'isIdle') descriptor.value = flags.isIdle;
            else if (field === 'isPending') descriptor.value = flags.isPending;
            else if (field === 'isSuccess') descriptor.value = flags.isSuccess;
            else if (field === 'isError') descriptor.value = flags.isError;
        }
        return descriptor;
    }, 'operational');
};
