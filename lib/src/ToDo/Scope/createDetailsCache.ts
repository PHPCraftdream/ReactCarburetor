import {ResourceCache} from "@/Carburetor";
import {ITodoDetails, IToDoClientAPI} from "@/ToDo/API/Models";

/**
 * Details for many todos from one loader: each id is its own entry, fresh for 30 s, at most 50
 * kept.
 *
 * @param api - the client the details load through
 */
export const createDetailsCache = (api: IToDoClientAPI): ResourceCache<ITodoDetails, string> => {
    return new ResourceCache<ITodoDetails, string>(
        (id: string, signal: AbortSignal) => api.getTodoDetails(id, signal),
        {ttl: 30_000, maxEntries: 50}
    );
};
