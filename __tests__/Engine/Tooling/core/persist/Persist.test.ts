import {
    Carburetor,
    IStorageLike,
    persist,
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
        const dispose = persist(carburetor, {key: 'counter', storage, coalesce: false});

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

    test('reports a failing write and lets later subscribers still run', () => {
        const failingStorage: IStorageLike = {
            getItem: () => null,
            setItem: () => {
                throw new Error('quota exceeded');
            },
            removeItem: () => undefined,
        };

        const carburetor = new CounterCarburetor(getData());
        let reported: unknown = undefined;
        let notified = 0;

        persist(carburetor, {
            key: 'counter',
            storage: failingStorage,
            coalesce: false,
            onError: (error: unknown) => (reported = error),
        });
        carburetor.subscribe(() => notified++, {id: 'after-persist'});

        expect(() => carburetor.setValue(1)).not.toThrow();

        expect((reported as Error).message).toEqual('quota exceeded');
        expect(notified).toEqual(1);
    });

    describe('coalesce (R33-07)', () => {
        test('with coalesce: false, a write lands before setValue returns', () => {
            const storage = new MemoryStorage();
            const carburetor = new CounterCarburetor(getData());

            persist(carburetor, {key: 'counter', storage, coalesce: false});
            carburetor.setValue(1);

            expect(JSON.parse(storage.getItem('counter') as string).value).toEqual(1);
        });

        test('by default (coalesce: true), several writes coalesce into one stringify', async () => {
            const storage = new MemoryStorage();
            const carburetor = new CounterCarburetor(getData());
            let writes = 0;
            const original = storage.setItem;

            storage.setItem = (key: string, value: string) => {
                writes++;
                original(key, value);
            };

            const dispose = persist(carburetor, {key: 'counter', storage});

            writes = 0;
            carburetor.setValue(1);
            carburetor.setValue(2);
            carburetor.setValue(3);

            expect(storage.getItem('counter')).toBeNull();

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));

            expect(writes).toEqual(1);
            expect(JSON.parse(storage.getItem('counter') as string).value).toEqual(3);

            dispose();
        });
    });
});
