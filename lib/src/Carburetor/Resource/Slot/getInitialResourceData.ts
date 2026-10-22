import {IResourceData} from "../../Models/Resource";
import {EResourceStatus} from "../../Models/Enums/EResourceStatus";
import {resourceStatusFlags} from "../Status/resourceStatusFlags";

/** The state of a resource nobody has loaded yet. */
export const getInitialResourceData = <T extends unknown>(): IResourceData<T> => ({
    ...resourceStatusFlags(EResourceStatus.Idle),
    status: EResourceStatus.Idle,
    data: undefined,
    error: undefined,
    updatedAt: undefined,
});
