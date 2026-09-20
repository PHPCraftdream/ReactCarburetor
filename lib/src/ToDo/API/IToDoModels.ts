import {IDict} from "../../Carburetor";

export interface ITodo {
    id: string;
    title: string;
    done: boolean;
}

export interface ITodoList {
    items: IDict<ITodo>;
    orderIds: string[];
    doneCount?: number;
    activeCount?: number;
}

export interface IToDoClientAPI {
    getTodoList: () => Promise<ITodoList>;
    updateTodoList: (data: ITodoList) => Promise<ITodoList>;
}
