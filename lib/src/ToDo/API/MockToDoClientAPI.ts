import {IToDoClientAPI, ITodoList} from "./Models";

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

/** A copy, so the fake server and the client never share a mutable object. */
const cloneDataObject = <T>(data: T): T => JSON.parse(JSON.stringify(data));

export class MockToDoClientAPI implements IToDoClientAPI {
    /** Returns the stored list, as a network client would. */
    public getTodoList = () => {
        return Promise.resolve(cloneDataObject(todoList));
    };

    /** Stores the list and echoes back what was saved. */
    public updateTodoList = (data: ITodoList) => {
        todoList = cloneDataObject(data);

        return Promise.resolve(todoList);
    };
}
