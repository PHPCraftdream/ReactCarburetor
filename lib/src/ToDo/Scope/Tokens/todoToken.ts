import {carburetorToken} from "../../../Carburetor/index";
import {MockToDoClientAPI} from "../../API/MockToDoClientAPI";
import {TodoCarburetor} from "../../Carburetors/TodoCarburetor";

/** The todo list, one instance per scope. */
export const todoToken = carburetorToken(() => new TodoCarburetor(new MockToDoClientAPI()), 'todos');
