import {ITodoList} from "./IToDoModels";

export const getDefaultTodos = (): ITodoList => ({
    items: {},
    orderIds: [],
});
