import {carburetorToken, ResourceCache} from "@/Carburetor";
import {ITodoDetails} from "@/ToDo/API/Models";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {createDetailsCache} from "@/ToDo/Scope/createDetailsCache";

/** Per-todo server details, cached by id, one cache per scope. */
export const detailsToken = carburetorToken<ResourceCache<ITodoDetails, string>>(
    () => createDetailsCache(new MockToDoClientAPI()),
    'details'
);
