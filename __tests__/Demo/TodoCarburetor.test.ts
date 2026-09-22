import {TPath, TPathSet} from "@/Carburetor";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {ITodo, IToDoClientAPI, ITodoList} from "@/ToDo/API/Models";
import {someCarburetor} from "@/ToDo/Carburetors/SomeCarburetorInstance";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";

/** The protected members a test wraps to count whole-list derivation work. */
interface IDerivationInternals {
    countStats: () => void;
    sortItems: () => void;
    compareOrderIds: (idA: string, idB: string) => number;
}

/** Running totals of the whole-list work a carburetor has done since it was instrumented. */
interface IDerivationCounts {
    countStats: number;
    sortItems: number;
    compareOrderIds: number;
}

/** A watcher's notification count plus the disposer that ends it. */
interface IWriteWatcher {
    writes: () => number;
    dispose: () => void;
}

/** Wraps the derivation internals with counters, leaving what they do alone. */
const countDerivation = (carburetor: TodoCarburetor): IDerivationCounts => {
    const internals = carburetor as unknown as IDerivationInternals;
    const counts: IDerivationCounts = {countStats: 0, sortItems: 0, compareOrderIds: 0};

    const realCountStats = internals.countStats;
    internals.countStats = (): void => {
        counts.countStats++;
        realCountStats();
    };

    const realSortItems = internals.sortItems;
    internals.sortItems = (): void => {
        counts.sortItems++;
        realSortItems();
    };

    const realCompareOrderIds = internals.compareOrderIds;
    internals.compareOrderIds = (idA: string, idB: string): number => {
        counts.compareOrderIds++;
        return realCompareOrderIds(idA, idB);
    };

    return counts;
};

/** Counts the writes that reach a set of paths, with the disposer to end the watch. */
const watchPaths = (carburetor: TodoCarburetor, ...paths: TPath[]): IWriteWatcher => {
    const reads: TPathSet = new Set<TPath>(paths);
    let notifications = 0;

    const dispose = carburetor.watch(reads, () => {
        notifications++;
    });

    return {writes: () => notifications, dispose};
};

/** Fires loadData and waits out the API promise, as the mount effect would. */
const loadThroughAPI = async (carburetor: TodoCarburetor): Promise<void> => {
    carburetor.loadData();

    await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve);
    });
};

/** An API that always answers with one fixed list, copied per call like a server would. */
const staticApi = (list: ITodoList): IToDoClientAPI => ({
    getTodoList: (): Promise<ITodoList> => Promise.resolve(JSON.parse(JSON.stringify(list)) as ITodoList),
    updateTodoList: (data: ITodoList): Promise<ITodoList> => Promise.resolve(data)
});

/** Done and active items intermixed, with stale counters and an order a stable sort moves. */
const getMixedList = (): ITodoList => ({
    items: {
        a: {id: 'a', title: 'active one', done: false},
        b: {id: 'b', title: 'done one', done: true},
        c: {id: 'c', title: 'active two', done: false},
        d: {id: 'd', title: 'done two', done: true}
    },
    orderIds: ['b', 'c', 'd', 'a'],
    doneCount: 99,
    activeCount: -3
});

/** One active item, with the optional counters left out, as an unhydrated initial state. */
const getUnhydratedList = (): ITodoList => ({
    items: {
        a: {id: 'a', title: 'active one', done: false}
    },
    orderIds: ['a']
});

/** One active and one done item, with the optional counters left out entirely. */
const getUnhydratedPair = (): ITodoList => ({
    items: {
        a: {id: 'a', title: 'active one', done: false},
        b: {id: 'b', title: 'done one', done: true}
    },
    orderIds: ['a', 'b']
});

describe('TodoCarburetor', () => {
    test('a title edit enumerates nothing, compares nothing, and publishes only the item', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const calls = countDerivation(carburetor);
        const item = watchPaths(carburetor, 'items.workTodo1');
        const order = watchPaths(carburetor, 'orderIds');
        const counters = watchPaths(carburetor, 'doneCount', 'activeCount');
        const versionBefore = carburetor.getVersion();
        const stored: ITodo = carburetor.getData().items.workTodo1;

        carburetor.updateTodo({...stored, title: 'do work #1 edited'});

        expect(calls.countStats).toEqual(0);
        expect(calls.sortItems).toEqual(0);
        expect(calls.compareOrderIds).toEqual(0);

        expect(item.writes()).toEqual(1);
        expect(order.writes()).toEqual(0);
        expect(counters.writes()).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore + 1);

        expect(carburetor.getData().items.workTodo1.title).toEqual('do work #1 edited');
        expect(carburetor.getData().orderIds).toEqual(['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9']);
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(4);

        item.dispose();
        order.dispose();
        counters.dispose();
    });

    test('toggling done moves the counts and re-places the id where the stable order keeps it', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const flip = (id: string, done: boolean): void => {
            carburetor.updateTodo({...carburetor.getData().items[id], done});
        };

        flip('workTodo1', true);

        expect(carburetor.getData().doneCount).toEqual(1);
        expect(carburetor.getData().activeCount).toEqual(3);
        expect(carburetor.getData().orderIds).toEqual(['workTodo5', 'workTodo8', 'workTodo9', 'workTodo1']);

        flip('workTodo1', false);

        // Un-doing joins the active block at the item's place in the sequence — last here,
        // since the flip had moved it to the end — the same place the stable sort keeps.
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(4);
        expect(carburetor.getData().orderIds).toEqual(['workTodo5', 'workTodo8', 'workTodo9', 'workTodo1']);

        // An item un-done from the middle lands after the still-active items, before the
        // done block, exactly where the stable sort would keep it.
        flip('workTodo5', true);
        flip('workTodo8', true);
        flip('workTodo5', false);

        expect(carburetor.getData().doneCount).toEqual(1);
        expect(carburetor.getData().activeCount).toEqual(3);
        expect(carburetor.getData().orderIds).toEqual(['workTodo9', 'workTodo1', 'workTodo5', 'workTodo8']);
    });

    test('creating puts an active item on top and moves only the active count', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const doneWatcher = watchPaths(carburetor, 'doneCount');

        carburetor.createTodo();

        const {items, orderIds} = carburetor.getData();
        const created: ITodo = items[orderIds[0]];

        expect(orderIds).toHaveLength(5);
        expect(created.done).toEqual(false);
        expect(created.title).toEqual('');
        expect(orderIds.slice(1)).toEqual(['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9']);
        expect(carburetor.getData().activeCount).toEqual(5);
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(doneWatcher.writes()).toEqual(0);

        doneWatcher.dispose();
    });

    test('deleting an active item lowers the active count and keeps the rest of the order', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        carburetor.deleteTodo('workTodo1');

        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(3);
        expect(carburetor.getData().orderIds).toEqual(['workTodo5', 'workTodo8', 'workTodo9']);
        expect('workTodo1' in carburetor.getData().items).toEqual(false);
    });

    test('deleting a done item lowers the done count and leaves the active count alone', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        carburetor.updateTodo({...carburetor.getData().items.workTodo1, done: true});
        carburetor.deleteTodo('workTodo1');

        // The delete only unwinds the done count the flip had raised; the active count stays
        // where the flip left it.
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(3);
        expect(carburetor.getData().orderIds).toEqual(['workTodo5', 'workTodo8', 'workTodo9']);
    });

    test('deleting an id the list does not hold changes nothing', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const watcher = watchPaths(carburetor, 'orderIds', 'doneCount', 'activeCount');
        const versionBefore = carburetor.getVersion();

        carburetor.deleteTodo('missing');

        expect(watcher.writes()).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
        expect(carburetor.getData().orderIds).toEqual(['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9']);

        watcher.dispose();
    });

    test('a repeated identical update does no work and notifies nobody', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const calls = countDerivation(carburetor);
        const item = watchPaths(carburetor, 'items.workTodo1');
        const order = watchPaths(carburetor, 'orderIds');
        const counters = watchPaths(carburetor, 'doneCount', 'activeCount');
        const versionBefore = carburetor.getVersion();
        const someVersionBefore = someCarburetor.getVersion();
        const messageBefore = someCarburetor.getData().emittedMessage;
        const stored: ITodo = carburetor.getData().items.workTodo1;

        carburetor.updateTodo({...stored});
        carburetor.updateTodo({...stored});

        expect(calls.countStats).toEqual(0);
        expect(calls.sortItems).toEqual(0);
        expect(calls.compareOrderIds).toEqual(0);
        expect(item.writes()).toEqual(0);
        expect(order.writes()).toEqual(0);
        expect(counters.writes()).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
        expect(someCarburetor.getVersion()).toEqual(someVersionBefore);
        expect(someCarburetor.getData().emittedMessage).toEqual(messageBefore);
        expect(carburetor.getData().items.workTodo1).toBe(stored);

        item.dispose();
        order.dispose();
        counters.dispose();
    });

    test('replacing the data derives the counters and the stable order from the new items', async () => {
        const carburetor = new TodoCarburetor(staticApi(getMixedList()));
        const calls = countDerivation(carburetor);

        await loadThroughAPI(carburetor);

        expect(calls.countStats).toBeGreaterThan(0);
        expect(calls.sortItems).toBeGreaterThan(0);
        expect(calls.compareOrderIds).toBeGreaterThan(0);

        expect(carburetor.getData().doneCount).toEqual(2);
        expect(carburetor.getData().activeCount).toEqual(2);
        expect(carburetor.getData().orderIds).toEqual(['c', 'a', 'b', 'd']);
    });

    test('restoring a snapshot derives the fields instead of keeping the stale ones', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        const calls = countDerivation(carburetor);

        carburetor.restore(getMixedList());

        expect(calls.countStats).toBeGreaterThan(0);
        expect(carburetor.getData().doneCount).toEqual(2);
        expect(carburetor.getData().activeCount).toEqual(2);
        expect(carburetor.getData().orderIds).toEqual(['c', 'a', 'b', 'd']);
    });

    test('an update for an id the list does not hold yet still derives the counters', () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        carburetor.updateTodo({id: 'fresh', title: 'written before the load', done: false});

        expect(carburetor.getData().items.fresh.title).toEqual('written before the load');
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(1);
        expect(carburetor.getData().orderIds).toEqual([]);
    });

    test('an update for an unknown id after the load counts it without touching the order', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());

        await loadThroughAPI(carburetor);

        carburetor.updateTodo({id: 'fresh', title: 'unlisted', done: true});

        expect(carburetor.getData().doneCount).toEqual(1);
        expect(carburetor.getData().activeCount).toEqual(4);
        expect(carburetor.getData().orderIds).toEqual(['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9']);
    });
});

describe('TodoCarburetor stable order matches a full resort', () => {
    test('toggling two items done in sequence lands each at the boundary, not the end', async () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI());
        await loadThroughAPI(carburetor);

        const flip = (id: string, done: boolean): void => {
            carburetor.updateTodo({...carburetor.getData().items[id], done});
        };

        // Reproduces the ORIGINAL preEmit: unconditionally re-sort the array resulting from
        // the previous sort, with the just-flipped item's done value already applied — the
        // real order the pre-JS-08 code would have produced after the same two flips. With
        // two items already done, appending a third done item to the *end* of the order
        // disagrees with this reference the moment its own original index precedes an
        // existing done item's — exactly what a full resort's stability would not do.
        let referenceOrder: string[] = ['workTodo1', 'workTodo5', 'workTodo8', 'workTodo9'];
        const doneOf: Record<string, boolean> = {
            workTodo1: false, workTodo5: false, workTodo8: false, workTodo9: false
        };
        const referenceFlip = (id: string, done: boolean): void => {
            doneOf[id] = done;
            referenceOrder = [...referenceOrder].sort((idA: string, idB: string) => {
                if (doneOf[idA] === doneOf[idB]) {
                    return 0;
                }

                return doneOf[idA] ? 1 : -1;
            });
        };

        flip('workTodo5', true);
        referenceFlip('workTodo5', true);
        flip('workTodo8', true);
        referenceFlip('workTodo8', true);

        expect(carburetor.getData().orderIds).toEqual(referenceOrder);
        expect(carburetor.getData().orderIds).toEqual(['workTodo1', 'workTodo9', 'workTodo8', 'workTodo5']);
    });
});

describe('TodoCarburetor counters missing from the initial data', () => {
    test('the first title edit derives the counters instead of publishing zeros', () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI(), getUnhydratedList());
        const calls = countDerivation(carburetor);
        const stored: ITodo = carburetor.getData().items.a;

        carburetor.updateTodo({...stored, title: 'active one edited'});

        expect(carburetor.getData().items.a.title).toEqual('active one edited');
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(1);

        // The first write took the whole-list pass; the counters it derived exist now, so
        // the next title edit is back on the incremental path.
        const countStatsAfterFirst: number = calls.countStats;

        expect(countStatsAfterFirst).toBeGreaterThan(0);

        carburetor.updateTodo({...carburetor.getData().items.a, title: 'active one edited twice'});

        expect(calls.countStats).toEqual(countStatsAfterFirst);
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(1);
    });

    test('creating on such a store counts the item the zero baseline never held', () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI(), getUnhydratedList());

        carburetor.createTodo();

        const {items, orderIds} = carburetor.getData();
        const created: ITodo = items[orderIds[0]];

        expect(orderIds).toHaveLength(2);
        expect(orderIds).toEqual([created.id, 'a']);
        expect(created.done).toEqual(false);
        expect(carburetor.getData().doneCount).toEqual(0);
        expect(carburetor.getData().activeCount).toEqual(2);
    });

    test('toggling on such a store derives both counts from the items', () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI(), getUnhydratedPair());

        carburetor.updateTodo({...carburetor.getData().items.a, done: true});

        expect(carburetor.getData().doneCount).toEqual(2);
        expect(carburetor.getData().activeCount).toEqual(0);
        expect(carburetor.getData().orderIds).toEqual(['a', 'b']);

        carburetor.updateTodo({...carburetor.getData().items.a, done: false});

        expect(carburetor.getData().doneCount).toEqual(1);
        expect(carburetor.getData().activeCount).toEqual(1);
        expect(carburetor.getData().orderIds).toEqual(['a', 'b']);
    });

    test('an already-initialized store keeps the single-item write off the whole-list pass', () => {
        const carburetor = new TodoCarburetor(new MockToDoClientAPI(), {
            items: {
                a: {id: 'a', title: 'active one', done: false},
                b: {id: 'b', title: 'done one', done: true}
            },
            orderIds: ['a', 'b'],
            doneCount: 1,
            activeCount: 1
        });
        const calls = countDerivation(carburetor);
        const counters = watchPaths(carburetor, 'doneCount', 'activeCount');

        carburetor.updateTodo({...carburetor.getData().items.a, title: 'active one edited'});

        expect(calls.countStats).toEqual(0);
        expect(calls.sortItems).toEqual(0);
        expect(calls.compareOrderIds).toEqual(0);
        expect(counters.writes()).toEqual(0);
        expect(carburetor.getData().items.a.title).toEqual('active one edited');
        expect(carburetor.getData().doneCount).toEqual(1);
        expect(carburetor.getData().activeCount).toEqual(1);

        counters.dispose();
    });
});
