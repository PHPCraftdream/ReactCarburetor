import {IResourceData} from '../../Models/Resource';

/** One request in flight for a resource slot's key.
 *
 * @param TArgs - loader argument tuple identifying the slot's request. */
export interface ISlotRequest<TArgs> {
    key: string;
    args: TArgs;
    controller: AbortController;
    promise: Promise<void>;
    /** Promise capture used to adopt a successor's outcome when this request is replaced. */
    resolve: (value: void | PromiseLike<void>) => void;
    generation: number;
    /** A revalidation started by a render read: suspend serves the visible data. */
    background?: boolean;
}

/** The last settled answer, kept alongside the request that replaced it.
 *
 * @param T - the resource value the answer carries. */
export interface ISlotAnswer<T> {
    key: string | undefined;
    owner: IResourceData<T>;
    failure?: {value: unknown; message: string | undefined};
}

/** Request and answer ownership for one resource slot.
 *
 * @param T - the resource value the runtime carries.
 * @param TArgs - loader argument tuple identifying the slot's requests. */
export interface ISlotRuntime<T, TArgs> {
    request?: ISlotRequest<TArgs>;
    answer?: ISlotAnswer<T>;
}
