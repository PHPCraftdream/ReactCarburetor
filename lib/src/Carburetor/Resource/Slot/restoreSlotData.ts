import {IResourceData, IResourceSnapshot} from "../../Models/Resource";
import {deepClone} from "../../Store/Utils/deepClone";
import {cloneOwnedGraph} from "../../Store/Utils/Graph/cloneOwnedGraph";
import {resourceStatusFlags} from "../Status/resourceStatusFlags";

const STATUS_FLAGS = ['isIdle', 'isPending', 'isSuccess', 'isError'] as const;

/**
 * Produces the state to install for a restored snapshot: an owned replay keeps the original
 * graph (relabeling status flags in place, or copying when a locked field holds a wrong
 * value), anything else installs a detached clone.
 *
 * @param data - the restored snapshot
 * @param status - the normalized status to install (a restored Pending becomes Idle)
 * @param ownedReplay - true when the history claim adopts the caller's graph
 */
export const restoreSlotData = <T>(
    data: IResourceSnapshot<T>,
    status: IResourceData<T>['status'],
    ownedReplay: boolean,
): IResourceData<T> => {
    const flags = resourceStatusFlags(status);
    if (!ownedReplay) {
        return deepClone({
            status, ...flags, data: data.data, error: data.error, updatedAt: data.updatedAt,
        });
    }
    const statusDescriptor = data.status !== status
        ? Object.getOwnPropertyDescriptor(data, 'status') : undefined;
    // A locked field holding a wrong value can only be fixed in a copy.
    const lockedWrongFlag = STATUS_FLAGS.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(data, key);
        return descriptor?.writable === false && descriptor.configurable === false
            && descriptor.value !== flags[key];
    });
    if (lockedWrongFlag || (statusDescriptor?.writable === false && statusDescriptor.configurable === false)) {
        return cloneOwnedGraph(data, undefined, (source, key, descriptor) => {
            if (source !== data) return descriptor;
            if (key === 'key') return undefined;
            if (key === 'status') descriptor.value = status;
            else if (key === 'isIdle') descriptor.value = flags.isIdle;
            else if (key === 'isPending') descriptor.value = flags.isPending;
            else if (key === 'isSuccess') descriptor.value = flags.isSuccess;
            else if (key === 'isError') descriptor.value = flags.isError;
            return descriptor;
        });
    }
    if (statusDescriptor?.writable === false) {
        statusDescriptor.value = status;
        Object.defineProperty(data, 'status', statusDescriptor);
    } else if (data.status !== status) {
        data.status = status;
    }
    delete data.key;
    // Equal values are skipped (locked ones are equal here); readonly ones go through defineProperty.
    for (const key of STATUS_FLAGS) {
        if (data[key] === flags[key]) continue;
        const descriptor = Object.getOwnPropertyDescriptor(data, key);
        if (descriptor?.writable === false) {
            descriptor.value = flags[key];
            Object.defineProperty(data, key, descriptor);
        } else {
            data[key] = flags[key];
        }
    }
    return data as IResourceData<T>;
};
