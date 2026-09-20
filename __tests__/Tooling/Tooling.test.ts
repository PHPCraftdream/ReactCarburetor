import {
    Carburetor,
    CarburetorHistory,
    ComponentUpdateThrottle,
    EDevToolsAction,
    EDevToolsMessageType,
    connectDevTools,
    IDevToolsConnection,
    IDevToolsMessage,
    IStorageLike,
    persist,
    waitForUpdate
} from "../../lib/src/Carburetor";

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

class MemoryStorage implements IStorageLike {
    protected entries: Map<string, string> = new Map<string, string>();

    public getItem = (key: string): string | null => {
        const value = this.entries.get(key);

        return value === undefined ? null : value;
    };

    public setItem = (key: string, value: string): void => {
        this.entries.set(key, value);
    };

    public removeItem = (key: string): void => {
        this.entries.delete(key);
    };
}

describe('persist', () => {
    test('loads stored state on connect and mirrors later changes', () => {
        const storage = new MemoryStorage();
        storage.setItem('counter', JSON.stringify({value: 7, label: 'stored'}));

        const carburetor = new CounterCarburetor(getData());
        const dispose = persist(carburetor, {key: 'counter', storage});

        expect(carburetor.getData().value).toEqual(7);

        carburetor.setValue(8);
        expect(JSON.parse(storage.getItem('counter') as string).value).toEqual(8);

        dispose();
        carburetor.setValue(9);
        expect(JSON.parse(storage.getItem('counter') as string).value).toEqual(8);
    });

    test('drops a corrupted entry and reports it', () => {
        const storage = new MemoryStorage();
        storage.setItem('counter', 'not json');

        const carburetor = new CounterCarburetor(getData());
        let reported: unknown = undefined;

        persist(carburetor, {key: 'counter', storage, onError: (error: unknown) => (reported = error)});

        expect(reported).not.toEqual(undefined);
        expect(storage.getItem('counter')).toEqual(null);
        expect(carburetor.getData().value).toEqual(0);
    });
});

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
