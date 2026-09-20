import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {TodoCarburetor} from "./TodoCarburetor";

export const todoCarburetor = new TodoCarburetor(new MockToDoClientAPI());
