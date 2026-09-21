import {ITodoList} from "./Models";

/** An empty list, used until the API answers. */
export const getDefaultTodos = (): ITodoList => ({
    items: {},
    orderIds: [],
});
