import {IResourceEntry} from "../../../Models/Resource";
import {EResourceStatus} from "../../../Models/Enums/EResourceStatus";
import {resourceStatusFlags} from "../../Status/resourceStatusFlags";

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
