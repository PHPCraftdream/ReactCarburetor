import {IDict} from "@/Carburetor";

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

/** What the server knows about one todo beyond the list itself. */
export interface ITodoDetails {
    id: string;
    estimateMinutes: number;
    checkedAt: string;
}

export interface IToDoClientAPI {
    getTodoList: (signal?: AbortSignal) => Promise<ITodoList>;
    updateTodoList: (data: ITodoList) => Promise<ITodoList>;
    getTodoDetails: (id: string, signal?: AbortSignal) => Promise<ITodoDetails>;
}
