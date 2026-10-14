import {IResourceData} from "@/Carburetor/Models/Resource";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {resourceStatusFlags} from "@/Carburetor/Resource/Status/resourceStatusFlags";

/** The state of a resource nobody has loaded yet. */
export const getInitialResourceData = <T extends unknown>(): IResourceData<T> => ({
    ...resourceStatusFlags(EResourceStatus.Idle),
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
});
