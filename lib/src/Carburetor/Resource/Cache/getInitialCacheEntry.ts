import {IResourceEntry} from "@/Carburetor/Models/Resource";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";

/** A fresh entry, before anything has been asked of the loader. */
export const getInitialCacheEntry = <T>(): IResourceEntry<T> => ({
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
    refreshing: false,
    invalidated: false,
});
