import {carburetorToken, ResourceCache} from "../../../Carburetor/index";
import {ITodoDetails} from "../../API/Models";
import {MockToDoClientAPI} from "../../API/MockToDoClientAPI";
import {createDetailsCache} from "../createDetailsCache";

/** Per-todo server details, cached by id, one cache per scope. */
export const detailsToken = carburetorToken<ResourceCache<ITodoDetails, [id: string]>>(
    () => createDetailsCache(new MockToDoClientAPI()),
    'details'
);
