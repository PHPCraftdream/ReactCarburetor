import {Carburetor, getUid} from "@/Carburetor";
import {ITodo, IToDoClientAPI, ITodoList} from "@/ToDo/API/Models";
import {getDefaultTodos} from "@/ToDo/API/getDefaultTodos";
import {TDeleteTodo, TUpdateTodo} from "./Models";
import {someCarburetor} from "./SomeCarburetorInstance";

export class TodoCarburetor extends Carburetor<ITodoList> {
    constructor(protected api: IToDoClientAPI, data: ITodoList = getDefaultTodos()) {
        super(data);
    }

    /** Writing through draft records the changed path, here `items.<id>`. */
    public updateTodo: TUpdateTodo = (data: ITodo) => {
        this.update((draft: ITodoList) => {
            draft.items[data.id] = data;
        });
    };

    public loadData = () => {
        void this.api.getTodoList().then(this.setData);
    };

    public createTodo = () => {
        const todo: ITodo = {
            id: getUid(),
            done: false,
            title: ''
        };

        this.update((draft: ITodoList) => {
            draft.items[todo.id] = todo;
            draft.orderIds.unshift(todo.id);
        });
    };

    public deleteTodo: TDeleteTodo = (id: string) => {
        const {items} = this.data;

        if (id in items) {
            const filterId = (listId: string) => id !== listId;

            this.update((draft: ITodoList) => {
                delete draft.items[id];
                draft.orderIds = this.data.orderIds.filter(filterId);
            });
        }
    };

    protected preEmit = () => {
        this.countStats();
        this.sortItems();

        someCarburetor.setEmittedMessage((new Date()).toISOString());
    };

    protected countStats = () => {
        const {items} = this.data;
        let doneCount = 0;

        const keys = Object.keys(items);

        keys.forEach((id: string) => {
            if (items[id].done) {
                doneCount++;
            }
        });

        this.draft.doneCount = doneCount;
        this.draft.activeCount = keys.length - doneCount;
    };

    protected sortItems = () => {
        const {items} = this.data;

        this.draft.orderIds.sort((idA: string, idB: string) => {
            const itemA = items[idA];
            const itemB = items[idB];

            if (itemA.done === itemB.done) {
                return 0;
            }

            return itemA.done ? 1 : -1;
        });
    };
}
