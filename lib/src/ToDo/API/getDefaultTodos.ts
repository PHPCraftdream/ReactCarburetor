import {ITodoList} from "./Models";

export const getDefaultTodos = (): ITodoList => ({
    items: {},
    orderIds: [],
});
