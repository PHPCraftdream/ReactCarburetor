import {
    Carburetor,
    CarburetorHistory,
    ComponentUpdateThrottle,
    EDevToolsAction,
    EDevToolsMessageType,
    connectDevTools,
    IDevToolsConnection,
    IDevToolsMessage,
    IInspectable,
    transaction,
    waitForUpdate
} from "@/Carburetor";

interface ICounterData {
    value: number;
    label: string;
}

const getData = (): ICounterData => ({value: 0, label: 'start'});

class CounterCarburetor extends Carburetor<ICounterData> {
    public setValue = (value: number) => {
        this.draft.value = value;

        this.emitUpdate();
    };

    public setLabel = (label: string) => {
        this.draft.label = label;

        this.emitUpdate();
    };
}

describe('CarburetorHistory', () => {
    test('undo and redo walk the recorded states', () => {
        const carburetor = new CounterCarburetor(getData());
        const history = new CarburetorHistory<ICounterData>(carburetor);

        expect(history.canUndo()).toBeFalsy();

        carburetor.setValue(1);
        carburetor.setValue(2);

        expect(history.canUndo()).toBeTruthy();

        expect(history.undo()).toBeTruthy();
        expect(carburetor.getData().value).toEqual(1);

        expect(history.undo()).toBeTruthy();
        expect(carburetor.getData().value).toEqual(0);

        expect(history.undo()).toBeFalsy();

        expect(history.redo()).toBeTruthy();
        expect(carburetor.getData().value).toEqual(1);

        expect(history.redo()).toBeTruthy();
        expect(carburetor.getData().value).toEqual(2);
        expect(history.canRedo()).toBeFalsy();

        history.disconnect();
    });

    test('a new change after undo clears the redo branch', () => {
        const carburetor = new CounterCarburetor(getData());
        const history = new CarburetorHistory<ICounterData>(carburetor);

        carburetor.setValue(1);
        history.undo();

        expect(history.canRedo()).toBeTruthy();

        carburetor.setValue(5);

        expect(history.canRedo()).toBeFalsy();
        expect(carburetor.getData().value).toEqual(5);

        history.disconnect();
    });

    test('keeps no more than the configured number of states', () => {
        const carburetor = new CounterCarburetor(getData());
        const history = new CarburetorHistory<ICounterData>(carburetor, {limit: 2});

        carburetor.setValue(1);
        carburetor.setValue(2);
        carburetor.setValue(3);

        expect(history.undo()).toBeTruthy();
        expect(history.undo()).toBeTruthy();
        expect(history.undo()).toBeFalsy();
        expect(carburetor.getData().value).toEqual(1);

        history.disconnect();
    });
});

describe('CarburetorHistory isolation', () => {
    interface INestedData {
        list: number[];
        meta: {
            title: string;
        };
    }

    class NestedCarburetor extends Carburetor<INestedData> {
        public push = (value: number) => {
            this.update((draft: INestedData) => {
                draft.list.push(value);
            });
        };

        public setTitle = (title: string) => {
            this.update((draft: INestedData) => {
                draft.meta.title = title;
            });
        };
    }

    const getNested = (): INestedData => ({list: [1], meta: {title: 'start'}});

    test('a recorded entry is not disturbed by later deep writes', () => {
        const carburetor = new NestedCarburetor(getNested());
        const history = new CarburetorHistory<INestedData>(carburetor);

        carburetor.push(2);
        carburetor.setTitle('changed');

        history.undo();
        history.undo();

        expect(carburetor.getData()).toEqual({list: [1], meta: {title: 'start'}});

        history.disconnect();
    });

    test('an entry on the redo stack survives writes made after undo', () => {
        const carburetor = new NestedCarburetor(getNested());
        const history = new CarburetorHistory<INestedData>(carburetor);

        carburetor.push(2);
        history.undo();

        expect(carburetor.getData().list).toEqual([1]);

        // Redo must bring back [1, 2] even though the store object was rebuilt meanwhile.
        expect(history.redo()).toBeTruthy();
        expect(carburetor.getData().list).toEqual([1, 2]);

        history.disconnect();
    });

    test('the restored state is not aliased by the store', () => {
        const carburetor = new NestedCarburetor(getNested());
        const history = new CarburetorHistory<INestedData>(carburetor);

        carburetor.push(2);
        history.undo();

        // Writing after an undo must not mutate the entry sitting on the redo stack.
        carburetor.push(9);

        expect(carburetor.getData().list).toEqual([1, 9]);
        expect(history.canRedo()).toBeFalsy();

        history.disconnect();
    });
});

describe('connectDevTools', () => {
    interface IFakeExtension {
        connection: IDevToolsConnection;
        sent: Array<{action: string; state: unknown}>;
        initial: unknown;
        emit: (message: IDevToolsMessage) => void;
    }

    const createFakeExtension = (): {extension: {connect: () => IDevToolsConnection}} & IFakeExtension => {
        const sent: Array<{action: string; state: unknown}> = [];
        let listener: ((message: IDevToolsMessage) => void) | undefined = undefined;
        let initial: unknown = undefined;

        const connection: IDevToolsConnection = {
            init: (state: unknown) => {
                initial = state;
            },
            send: (action: string, state: unknown) => {
                sent.push({action, state});
            },
            subscribe: (next: (message: IDevToolsMessage) => void) => {
                listener = next;

                return () => {
                    listener = undefined;
                };
            },
        };

        return {
            extension: {connect: () => connection},
            connection,
            sent,
            get initial() {
                return initial;
            },
            emit: (message: IDevToolsMessage) => {
                if (listener) {
                    listener(message);
                }
            },
        };
    };

    const countClones = (store: IInspectable): {count: () => number} => {
        let calls = 0;
        // snapshot is a prototype method now, not a bound field: detaching it needs an
        // explicit bind, the same as any other method taken off its instance.
        const original = store.snapshot.bind(store);

        store.snapshot = (): unknown => {
            calls++;

            return original();
        };

        return {count: () => calls};
    };

    test('publishes the initial state and every change', () => {
        const carburetor = new CounterCarburetor(getData());
        const fake = createFakeExtension();

        const dispose = connectDevTools({counter: carburetor}, {extension: fake.extension});

        expect(fake.initial).toEqual({counter: {value: 0, label: 'start'}});

        carburetor.setValue(3);

        expect(fake.sent.length).toEqual(1);
        expect(fake.sent[0].action).toEqual('counter/update');
        expect(fake.sent[0].state).toEqual({counter: {value: 3, label: 'start'}});

        dispose();
        carburetor.setValue(4);
        expect(fake.sent.length).toEqual(1);
    });

    test('applies time travel back onto the carburetor without echoing it', () => {
        const carburetor = new CounterCarburetor(getData());
        const fake = createFakeExtension();

        const dispose = connectDevTools({counter: carburetor}, {extension: fake.extension});

        carburetor.setValue(5);
        const sentAfterChange = fake.sent.length;

        fake.emit({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.JumpToAction, actionId: 1},
            state: JSON.stringify({counter: {value: 1, label: 'start'}}),
        });

        expect(carburetor.getData().value).toEqual(1);
        expect(fake.sent.length).toEqual(sentAfterChange);

        dispose();
    });

    test('is a no-op when no extension is present', () => {
        const carburetor = new CounterCarburetor(getData());
        const dispose = connectDevTools({counter: carburetor});

        expect(() => {
            carburetor.setValue(1);
            dispose();
        }).not.toThrow();
    });

    test('reuses the snapshot of an unchanged store when another store changes', () => {
        const first = new CounterCarburetor(getData());
        const second = new CounterCarburetor(getData());
        const firstClones = countClones(first);
        const secondClones = countClones(second);
        const fake = createFakeExtension();

        const dispose = connectDevTools({first, second}, {extension: fake.extension});

        expect(firstClones.count()).toEqual(1);
        expect(secondClones.count()).toEqual(1);

        first.setValue(3);

        expect(fake.sent.length).toEqual(1);
        expect(fake.sent[0].action).toEqual('first/update');
        expect(fake.sent[0].state).toEqual({first: {value: 3, label: 'start'}, second: {value: 0, label: 'start'}});
        // The unchanged store keeps the copy taken at init; only the changed store is re-cloned.
        expect(firstClones.count()).toEqual(2);
        expect(secondClones.count()).toEqual(1);

        dispose();
    });

    test('a transaction over several stores sends consistent payloads without re-cloning settled versions', () => {
        const first = new CounterCarburetor(getData());
        const second = new CounterCarburetor(getData());
        const firstClones = countClones(first);
        const secondClones = countClones(second);
        const fake = createFakeExtension();

        const dispose = connectDevTools({first, second}, {extension: fake.extension});

        transaction(() => {
            first.setValue(1);
            second.setValue(2);
        });

        expect(fake.sent.length).toEqual(2);
        expect(fake.sent[0].action).toEqual('first/update');
        expect(fake.sent[0].state).toEqual({first: {value: 1, label: 'start'}, second: {value: 2, label: 'start'}});
        expect(fake.sent[1].action).toEqual('second/update');
        expect(fake.sent[1].state).toEqual({first: {value: 1, label: 'start'}, second: {value: 2, label: 'start'}});
        // One copy at init plus one after each store's version moved; the second publish reuses both.
        expect(firstClones.count()).toEqual(2);
        expect(secondClones.count()).toEqual(2);

        dispose();
    });

    test('a published payload stays detached from later writes', () => {
        const first = new CounterCarburetor(getData());
        const second = new CounterCarburetor(getData());
        const fake = createFakeExtension();

        const dispose = connectDevTools({first, second}, {extension: fake.extension});

        first.setValue(3);
        const published = fake.sent[0].state;

        first.setValue(4);
        second.setValue(7);

        expect(published).toEqual({first: {value: 3, label: 'start'}, second: {value: 0, label: 'start'}});
        // Each write publishes its own message; the last payload carries both fresh values while
        // the payload captured above still shows the states it had when it was sent.
        expect(fake.sent.length).toEqual(3);
        expect(fake.sent[2].state).toEqual({first: {value: 4, label: 'start'}, second: {value: 7, label: 'start'}});

        dispose();
    });

    test('rollback rewinds the stores and the next publish reflects the rewound state', () => {
        const first = new CounterCarburetor(getData());
        const second = new CounterCarburetor(getData());
        const fake = createFakeExtension();

        const dispose = connectDevTools({first, second}, {extension: fake.extension});

        first.setValue(5);
        second.setValue(6);
        const sentAfterChanges = fake.sent.length;

        fake.emit({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.Rollback},
            state: JSON.stringify({first: {value: 1, label: 'start'}, second: {value: 0, label: 'start'}}),
        });

        expect(first.getData().value).toEqual(1);
        expect(second.getData().value).toEqual(0);
        expect(fake.sent.length).toEqual(sentAfterChanges);

        second.setValue(2);

        expect(fake.sent[fake.sent.length - 1].state)
            .toEqual({first: {value: 1, label: 'start'}, second: {value: 2, label: 'start'}});

        dispose();
    });

    test('without an extension, transactions and disposal remain no-ops', () => {
        const first = new CounterCarburetor(getData());
        const second = new CounterCarburetor(getData());
        const dispose = connectDevTools({first, second});

        expect(() => transaction(() => {
            first.setValue(1);
            second.setValue(2);
        })).not.toThrow();
        expect(() => {
            dispose();
            dispose();
        }).not.toThrow();
        expect(first.getData().value).toEqual(1);
    });
});

describe('waitForUpdate', () => {
    test('resolves on the next update of a throttled carburetor', async () => {
        const carburetor = new CounterCarburetor(getData(), new ComponentUpdateThrottle(10));

        const updated = waitForUpdate(carburetor);
        carburetor.setValue(1);

        await updated;

        expect(carburetor.getData().value).toEqual(1);
    });

    test('rejects when nothing happens in time', async () => {
        const carburetor = new CounterCarburetor(getData());

        await expect(waitForUpdate(carburetor, 20)).rejects.toThrow(/no update/);
    });
});
