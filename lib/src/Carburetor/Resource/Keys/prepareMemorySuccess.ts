import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData} from "@/Carburetor/Models/Resource";
import {cloneOwnedGraph} from "@/Carburetor/Store/Utils/Graph/cloneOwnedGraph";
import {resourceStatusFlags} from "@/Carburetor/Resource/Status/resourceStatusFlags";

/** Fields a memory-hit publication owns; the same set a request settles. */
const isPublishField = (field: PropertyKey): boolean =>
    field === 'status' || field === 'data' || field === 'error' || field === 'updatedAt'
    || field === 'isIdle' || field === 'isPending' || field === 'isSuccess' || field === 'isError';

/** Whether a descriptor permits writing, or is absent. */
const isWritableDescriptor = (descriptor: PropertyDescriptor | undefined): boolean =>
    descriptor?.writable !== false;

/** Prepare a writable graph for a remembered answer, or undefined when the state is writable.
 *
 * @param state - The graph a remembered answer is about to be published into.
 * @param remembered - The remembered answer that supplies the new data and timestamp.
 */
export const prepareMemorySuccess = <T>(
    state: IResourceData<T>, remembered: {data: T; updatedAt: number},
): IResourceData<T> | undefined => {
    const fields = ['status', 'data', 'error', 'updatedAt',
        'isIdle', 'isPending', 'isSuccess', 'isError'] as const;
    const writable = fields.every((field) => isWritableDescriptor(Object.getOwnPropertyDescriptor(state, field)));
    if (writable) return undefined;

    const flags = resourceStatusFlags(EResourceStatus.Success);
    return cloneOwnedGraph(state, undefined, (source, field, descriptor) => {
        if (source === state && isPublishField(field)) {
            descriptor.writable = true;
            if (field === 'status') descriptor.value = EResourceStatus.Success;
            else if (field === 'data') descriptor.value = remembered.data;
            else if (field === 'error') descriptor.value = undefined;
            else if (field === 'updatedAt') descriptor.value = remembered.updatedAt;
            else if (field === 'isIdle') descriptor.value = flags.isIdle;
            else if (field === 'isPending') descriptor.value = flags.isPending;
            else if (field === 'isSuccess') descriptor.value = flags.isSuccess;
            else if (field === 'isError') descriptor.value = flags.isError;
        }
        return descriptor;
    }, 'operational');
};
