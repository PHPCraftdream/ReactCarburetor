import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData} from "@/Carburetor/Models/Resource";

/** The state of a resource nobody has loaded yet. */
export const getInitialResourceData = <T extends unknown>(): IResourceData<T> => ({
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
});
