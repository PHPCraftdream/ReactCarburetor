import {Carburetor, getUid} from "@/Carburetor";
import {ITodo, IToDoClientAPI, ITodoList} from "@/ToDo/API/Models";
import {getDefaultTodos} from "@/ToDo/API/getDefaultTodos";
import {TDeleteTodo, TUpdateTodo} from "./Models";
import {someCarburetor} from "./SomeCarburetorInstance";

export class TodoCarburetor extends Carburetor<ITodoList> {
    /**
     * Set around a single-item write that keeps the derived fields current itself; preEmit
     * consumes it and skips the whole-list pass for that one emit.
     *
     * Any other emit — data replaced through setData, a restore — leaves it false and takes
     * the full pass.
     */
    private derivationKeptInline: boolean = false;

    /**
     * Takes the API the list is loaded and saved through, plus the state to start from.
     *
     * @param api - the client every load goes through; loadData swaps the whole list for its answer
     * @param data - the state shown before the first load; left out, it starts empty until the
     * api answers
     */
    constructor(protected api: IToDoClientAPI, data: ITodoList = getDefaultTodos()) {
        super(data);
    }

    /**
     * Writes one todo back, doing only the work the write actually causes.
     *
     * A title-only edit touches the item and nothing else, a completion flip moves the
     * counters by the old and new state and re-places the id where the stable order keeps
     * it, and a write identical to what is stored is dropped before it reaches the draft.
     *
     * @param data - the todo as it should be, replacing the stored one with the same id
     */
    public updateTodo: TUpdateTodo = (data: ITodo) => {
        const previous: ITodo | undefined = this.data.items[data.id];

        if (previous && previous.title === data.title && previous.done === data.done) {
            return;
        }

        this.derivationKeptInline = true;

        this.update((draft: ITodoList) => {
            draft.items[data.id] = data;

            this.shiftCounters(draft, previous ? previous.done : undefined, data.done, !previous);
            this.moveToStablePlace(draft, data.id, previous, data.done);
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

        this.derivationKeptInline = true;

        this.update((draft: ITodoList) => {
            draft.items[todo.id] = todo;
            draft.orderIds.unshift(todo.id);

            this.shiftCounters(draft, undefined, false, true);
        });
    };

    /** Removes an item and its place in the order, if the id is there at all. */
    public deleteTodo: TDeleteTodo = (id: string) => {
        const {items} = this.data;

        if (id in items) {
            const wasDone: boolean = items[id].done;
            const filterId = (listId: string) => id !== listId;

            this.derivationKeptInline = true;

            this.update((draft: ITodoList) => {
                delete draft.items[id];
                draft.orderIds = this.data.orderIds.filter(filterId);

                if (wasDone) {
                    draft.doneCount = (draft.doneCount ?? 0) - 1;
                } else {
                    draft.activeCount = (draft.activeCount ?? 0) - 1;
                }
            });
        }
    };

    /**
     * Recomputes the derived fields before an update goes out, so they never lag the items.
     *
     * A single-item action has kept them current inline and asks for that to be trusted;
     * every other path — initial data replacement, a restore, anything unrecognized — takes
     * the whole-list pass, so hydration never publishes stale counters. An emit that recorded
     * no path changed nothing, so it neither derives nor moves the timestamp.
     */
    protected preEmit = () => {
        const keptInline: boolean = this.derivationKeptInline;

        this.derivationKeptInline = false;

        if (this.writes.size === 0) {
            return;
        }

        // The inline arithmetic adds to the counters it finds, so a write that lands before
        // the first derivation — or against counters never derived — recounts instead.
        if (!keptInline || this.data.doneCount === undefined || this.data.activeCount === undefined) {
            this.countStats();
            this.sortItems();
        }

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
        this.draft.orderIds.sort(this.compareOrderIds);
    };

    /**
     * The ordering rule: a done item sorts after an active one, ties keep their places.
     *
     * @param idA - one of the two order ids being compared
     * @param idB - the other of the two order ids being compared
     */
    protected compareOrderIds = (idA: string, idB: string): number => {
        const itemA: ITodo = this.data.items[idA];
        const itemB: ITodo = this.data.items[idB];

        if (itemA.done === itemB.done) {
            return 0;
        }

        return itemA.done ? 1 : -1;
    };

    /**
     * Moves one completion change into the counters: a flip shifts one between done and
     * active, and an item the write adds also grows the list itself.
     *
     * @param draft - the list being written, whose counters are adjusted in place
     * @param wasDone - the item's completion before the write; left out when it is a new id
     * @param isDone - the item's completion after the write
     * @param isNew - whether the write introduces the id, which grows the list by one
     */
    private shiftCounters = (draft: ITodoList, wasDone?: boolean, isDone?: boolean, isNew?: boolean): void => {
        const doneDelta: number = (isDone ? 1 : 0) - (wasDone ? 1 : 0);

        draft.doneCount = (draft.doneCount ?? 0) + doneDelta;
        draft.activeCount = (draft.activeCount ?? 0) + (isNew ? 1 : 0) - doneDelta;
    };

    /**
     * Re-places a toggled id where the stable order keeps it: right at the boundary between
     * the active and done blocks, whichever side it now belongs to. Title edits, new ids and
     * ids the order does not hold leave the order as it is.
     *
     * The boundary position is the same regardless of direction: a full stable resort keeps
     * every other item's relative order, and both a freshly-active item (last of the actives)
     * and a freshly-done item (first of the dones, since it was active — earlier in the order
     * — a moment ago) land exactly there. Landing a freshly-done item at the *end* of the done
     * block instead would only agree with a full resort when at most one item is done.
     *
     * @param draft - the list being written, whose orderIds get one id re-placed
     * @param id - the id of the todo the write touched
     * @param previous - the stored todo before the write; left out when the id is new
     * @param isDone - the todo's completion after the write
     */
    private moveToStablePlace = (draft: ITodoList, id: string, previous?: ITodo, isDone?: boolean): void => {
        if (!previous || previous.done === isDone) {
            return;
        }

        const order: string[] = draft.orderIds;
        const at: number = order.indexOf(id);

        if (at === -1) {
            return;
        }

        order.splice(at, 1);

        let insertAt: number = order.length;

        for (let index = 0; index < order.length; index++) {
            const item: ITodo = this.data.items[order[index]];

            if (item && item.done) {
                insertAt = index;

                break;
            }
        }

        order.splice(insertAt, 0, id);
    };
}
