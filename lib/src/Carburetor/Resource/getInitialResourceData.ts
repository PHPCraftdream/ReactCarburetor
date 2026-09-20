import {IResourceData} from "../Models/Resource";

export const getInitialResourceData = <T extends unknown>(): IResourceData<T> => ({
    status: 'idle',
    data: undefined,
    error: undefined,
    updatedAt: undefined,
});
