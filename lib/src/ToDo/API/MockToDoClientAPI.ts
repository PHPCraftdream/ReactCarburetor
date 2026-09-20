import {IToDoClientAPI, ITodoList} from "./IToDoModels";

export const getDefaultTodos = (): ITodoList => ({
    items: {},
    orderIds: [],
});

let todoList: ITodoList = {
    items: {
        workTodo1: {
            id: 'workTodo1',
            done: false,
            title: 'do work #1',
        },
        workTodo5: {
            id: 'workTodo5',
            done: false,
            title: 'do lunch',
        },
        workTodo8: {
            id: 'workTodo8',
            done: false,
            title: 'do work #2',
        },
        workTodo9: {
            id: 'workTodo9',
            done: false,
            title: 'go home',
        }
    },
    orderIds: ['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9']
};

const cloneDataObject = <T>(data: T): T => JSON.parse(JSON.stringify(data));

export class MockToDoClientAPI implements IToDoClientAPI {
    public getTodoList = () => {
        return Promise.resolve(cloneDataObject(todoList));
    };

    public updateTodoList = (data: ITodoList) => {
        todoList = cloneDataObject(data);

        return Promise.resolve(todoList);
    };
}
