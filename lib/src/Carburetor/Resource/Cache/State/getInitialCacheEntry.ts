import {IResourceEntry} from "@/Carburetor/Models/Resource";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {resourceStatusFlags} from "@/Carburetor/Resource/Status/resourceStatusFlags";

/** A fresh entry, before anything has been asked of the loader. */
export const getInitialCacheEntry = <T>(): IResourceEntry<T> => ({
    ...resourceStatusFlags(EResourceStatus.Idle),
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
    refreshing: false,
    invalidated: false,
    failed: false,
});
