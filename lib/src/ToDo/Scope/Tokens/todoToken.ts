import {carburetorToken} from "@/Carburetor";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";

/** The todo list, one instance per scope. */
export const todoToken = carburetorToken(() => new TodoCarburetor(new MockToDoClientAPI()), 'todos');
