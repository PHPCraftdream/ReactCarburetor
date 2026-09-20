import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData} from "@/Carburetor/Models/Resource";

export const getInitialResourceData = <T extends unknown>(): IResourceData<T> => ({
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
});
