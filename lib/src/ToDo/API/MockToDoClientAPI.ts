import {ITodoDetails, IToDoClientAPI, ITodoList} from "./Models";

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

/** A stable pseudo-estimate, so the same id always gets the same answer. */
const estimateOf = (id: string): number => {
    let hash = 0;

    for (let index = 0; index < id.length; index++) {
        hash = (hash * 31 + id.charCodeAt(index)) % 997;
    }

    return 5 + hash % 55;
};

export class MockToDoClientAPI implements IToDoClientAPI {
    /**
     * Takes how slow the fake network is.
     *
     * @param latency - milliseconds each answer takes; 0 answers on the next microtask
     */
    constructor(protected latency: number = 0) {
    }

    /** Returns the stored list, as a network client would. */
    public getTodoList = (signal?: AbortSignal): Promise<ITodoList> => {
        return this.respond(() => cloneDataObject(todoList), signal);
    };

    /** Stores the list and echoes back what was saved. */
    public updateTodoList = (data: ITodoList): Promise<ITodoList> => {
        todoList = cloneDataObject(data);

        return this.respond(() => cloneDataObject(todoList));
    };

    /**
     * Answers the server-side details of one todo, fresh on every call.
     *
     * @param id - the todo asked about
     * @param signal - cancels the answer while it is on its way
     */
    public getTodoDetails = (id: string, signal?: AbortSignal): Promise<ITodoDetails> => {
        return this.respond(() => ({id, estimateMinutes: estimateOf(id), checkedAt: new Date().toISOString()}), signal);
    };

    /**
     * Resolves after the latency, or rejects with an AbortError once the signal fires.
     *
     * @param answer - builds the value when the latency is over
     * @param signal - cancels the answer while it is on its way
     */
    protected respond = <T>(answer: () => T, signal?: AbortSignal): Promise<T> => {
        if (this.latency === 0) {
            return Promise.resolve(answer());
        }

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => resolve(answer()), this.latency);

            signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('The request was aborted.', 'AbortError'));
            }, {once: true});
        });
    };
}
