import {CarburetorScope, IStorageLike, persist, TDisposer} from "@/Carburetor";
import {IToDoClientAPI} from "@/ToDo/API/Models";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";
import {UndoCarburetor} from "@/ToDo/Carburetors/UndoCarburetor";
import {TodoViews} from "@/ToDo/Derived/TodoViews";
import {createDetailsCache} from "./createDetailsCache";
import {ITodoScope} from "./Models";
import {detailsToken} from "./Tokens/detailsToken";
import {filterToken} from "./Tokens/filterToken";
import {statusToken} from "./Tokens/statusToken";
import {todoToken} from "./Tokens/todoToken";
import {undoToken} from "./Tokens/undoToken";
import {viewsToken} from "./Tokens/viewsToken";

/**
 * One app instance's stores: a scope per page (or per request, on a server), never module
 * singletons, so two mounted apps or two test cases cannot share state.
 *
 * @param api - the client the todo list loads through
 * @param storage - where the filter survives a reload; left out, nothing is persisted
 */
export const createTodoScope = (api: IToDoClientAPI = new MockToDoClientAPI(), storage?: IStorageLike): ITodoScope => {
    const scope = new CarburetorScope();

    scope.set(todoToken, new TodoCarburetor(api));
    scope.set(detailsToken, createDetailsCache(api));

    const todos = scope.get(todoToken);
    const status = scope.get(statusToken);

    const filter = scope.get(filterToken);
    const undo = new UndoCarburetor(todos);

    scope.set(viewsToken, new TodoViews(todos, filter));
    scope.set(undoToken, undo);

    // Loads what was stored, then mirrors every change back.
    const stopPersist: TDisposer = storage ? persist(filter, {key: 'todo-demo:filter', storage}) : () => undefined;

    // Outside React, a store is observed with subscribe(); no reads means every write.
    const statusSubscriptionId = todos.subscribe(() => {
        status.setEmittedMessage((new Date()).toISOString());
    });
    const stopStatus = () => todos.unsubscribe(statusSubscriptionId);

    return {
        scope,
        dispose: () => {
            stopStatus();
            stopPersist();
            undo.disconnect();
        },
    };
};
