import {EResourceStatus} from "./Enums/EResourceStatus";

export interface IResourceData<T> {
    status: EResourceStatus;
    data: T | undefined;
    /** Message only: the resource state has to stay serializable for SSR and devtools. */
    error: string | undefined;
    updatedAt: number | undefined;
}

export type TResourceLoader<T, TArgs> = (args: TArgs, signal: AbortSignal) => Promise<T>;
