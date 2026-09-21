import {Carburetor, getUid} from "@/Carburetor";
import {ITodo, IToDoClientAPI, ITodoList} from "@/ToDo/API/Models";
import {getDefaultTodos} from "@/ToDo/API/getDefaultTodos";
import {TDeleteTodo, TUpdateTodo} from "./Models";
import {someCarburetor} from "./SomeCarburetorInstance";

export class TodoCarburetor extends Carburetor<ITodoList> {
    /** Takes the API the list is loaded and saved through, plus the state to start from. */
    constructor(protected api: IToDoClientAPI, data: ITodoList = getDefaultTodos()) {
        super(data);
    }

    /** Writing through draft records the changed path, here `items.<id>`. */
    public updateTodo: TUpdateTodo = (data: ITodo) => {
        this.update((draft: ITodoList) => {
            draft.items[data.id] = data;
        });
    };

    /** Replaces the whole list with what the API returns. */
    public loadData = () => {
        void this.api.getTodoList().then(this.setData);
    };

    /** Adds an empty item at the top of the order. */
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

    /** Removes an item and its place in the order, if the id is there at all. */
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

    /** Recomputes the derived fields before an update goes out, so they never lag the items. */
    protected preEmit = () => {
        this.countStats();
        this.sortItems();

        someCarburetor.setEmittedMessage((new Date()).toISOString());
    };

    /** Writes the done/active counters, which components read instead of counting again. */
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

    /** Keeps done items last in the display order, leaving their relative order alone. */
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
