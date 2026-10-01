import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor, AntiHookComponent} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';
import {useCarburetorValue} from '@/Interop';

interface IDateGraph {
    key: Date;
    index: Map<Date, Date>;
    members: Set<Date>;
    revision: number;
}

interface IDateSelection {
    key: TReadonly<Date>;
    index: TReadonly<Map<Date, Date>>;
    members: TReadonly<Set<Date>>;
    revision: number;
}

const graph = (time: number, order: 'key-first' | 'index-first'): IDateGraph => {
    const date = new Date(time);
    const index = new Map([[date, date]]);
    const members = new Set([date]);

    return order === 'key-first'
        ? {key: date, index, members, revision: time}
        : {index, members, key: date, revision: time};
};

const selection = (data: TReadonly<IDateGraph>, order: 'key-first' | 'index-first'): IDateSelection =>
    order === 'key-first'
        ? {key: data.key, index: data.index, members: data.members, revision: data.revision}
        : {index: data.index, members: data.members, key: data.key, revision: data.revision};

const assertAliased = (value: IDateSelection, source: IDateGraph): void => {
    expect(value.key).not.toBe(source.key);
    expect([...value.index.keys()][0]).toBe(value.key);
    expect(value.index.get(value.key)).toBe(value.key);
    expect([...value.members][0]).toBe(value.key);
    value.key.setTime(9000);
    expect(source.key.getTime()).toBe(value.revision);
};

describe('Date alias detachment through public consumers (R11-05)', () => {
    test.each(['key-first', 'index-first'] as const)('watch delivers one Date copy (%s)', order => {
        const store = new Carburetor(graph(1000, order));
        const values: IDateSelection[] = [];
        const stop = store.watch(data => selection(data, order), next => values.push(next));

        store.setData(graph(2000, order));
        expect(values).toHaveLength(1);
        assertAliased(values[0], store.getData());
        stop();
        store.setData(graph(3000, order));
        expect(values).toHaveLength(1);
    });

    test.each(['key-first', 'index-first'] as const)('hook hands out a connected Date graph (%s)', order => {
        const store = new Carburetor(graph(1000, order));
        const values: IDateSelection[] = [];

        const View = () => {
            const value = useCarburetorValue(store, data => selection(data, order));
            values.push(value);
            return <span>{value.index.get(value.key)?.getTime() ?? 'missing'}</span>;
        };
        const {container, unmount} = render(<View/>);

        expect(container.textContent).toBe('1000');
        assertAliased(values[0], store.getData());
        act(() => { store.setData(graph(2000, order)); });
        expect(container.textContent).toBe('2000');
        assertAliased(values[values.length - 1], store.getData());
        unmount();
        act(() => { store.setData(graph(3000, order)); });
        expect(container.textContent).toBe('');
    });
});

describe('native own data fields through public selections (R30-04)', () => {
    test('a root Map watch publishes its content copy; own fields are not part of a selection', () => {
        class MapStore extends Carburetor<Map<string, number>> {
            public change(): void {
                this.update(draft => {
                    // The Map root is intentionally opaque to draft tracking.
                    // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
                    draft.set('id', 2);
                });
            }
        }

        const index = new Map([['id', 1]]);
        Object.defineProperty(index, 'label', {
            value: {text: 'current', owner: index}, enumerable: false, writable: false, configurable: false
        });
        const store = new MapStore(index);
        const seen: Array<Map<string, number>> = [];
        const stop = store.watch(data => data, next => { seen.push(next); });

        store.change();
        expect(seen).toHaveLength(1);

        const copy = seen[0];
        expect(copy).not.toBe(index);
        expect(copy.get('id')).toBe(2);
        // R30-04: the own field is not part of a selection and is not copied.
        expect(Object.getOwnPropertyDescriptor(copy, 'label')).toBeUndefined();
        expect(Object.getOwnPropertySymbols(copy)).toEqual([]);

        copy.set('id', 99);
        expect(store.getData().get('id')).toBe(2);
        stop();
    });
});

interface IPlainKeyGraph {
    key: {id: number};
    index: Map<{id: number}, string>;
}

type TPlainSelection = {
    key: {id: number};
    index: Map<{id: number}, string>;
    repeated: {id: number};
    self?: TPlainSelection;
};

class PlainKeyStore extends Carburetor<IPlainKeyGraph> {
    /** Changes a field without replacing the raw Map key. */
    public changeId(): void {
        this.update(draft => { draft.key.id = 2; });
    }

    /** Publishes a coarse Map write independently of the tracked key field. */
    public changeIndex(): void {
        const key = this.getData().key;
        this.update(draft => {
            // The Map is intentionally opaque to draft tracking.
            // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
            draft.index.set(key, 'updated');
        });
    }
}

const plainStore = (): PlainKeyStore => {
    const key = {id: 1};
    const index = new Map([[key, 'answer']]);
    Object.defineProperty(index, 'label', {
        value: {key, index}, enumerable: false, writable: false, configurable: false
    });
    return new PlainKeyStore({key, index});
};

const selectPlain = (
    data: TReadonly<IPlainKeyGraph>,
    order: 'key-first' | 'index-first'
): TPlainSelection => {
    const result = order === 'key-first'
        ? {key: data.key, index: data.index, repeated: data.key}
        : {index: data.index, repeated: data.key, key: data.key};
    const cycle = result as TPlainSelection;
    cycle.self = cycle;
    return cycle;
};

const assertPlainAlias = (value: TPlainSelection, store: PlainKeyStore, answer: string): void => {
    expect(value.self).toBe(value);
    expect(value.repeated).toBe(value.key);
    expect(value.key).toBe(value.index.keys().next().value);
    expect(value.index.get(value.key)).toBe(answer);
    expect(value.key).not.toBe(store.getData().key);
    expect(value.index).not.toBe(store.getData().index);
    // R30-04: the Map's own fields are not part of a selection and are not copied.
    expect(Object.getOwnPropertyDescriptor(value.index, 'label')).toBeUndefined();
};

describe('tracked plain key and raw Map graph (R13-E03)', () => {
    test.each(['key-first', 'index-first'] as const)('watch retains topology and both tracked writes (%s)', order => {
        const store = plainStore();
        const values: TPlainSelection[] = [];
        const stop = store.watch(data => selectPlain(data, order), next => values.push(next));

        store.changeId();
        expect(values).toHaveLength(1);
        assertPlainAlias(values[0], store, 'answer');
        expect(values[0].key.id).toBe(2);
        values[0].key.id = 99;
        expect(store.getData().key.id).toBe(2);

        store.changeIndex();
        expect(values).toHaveLength(2);
        assertPlainAlias(values[1], store, 'updated');
        stop();
    });

    test.each(['key-first', 'index-first'] as const)('hook renders detached lookup after each write (%s)', order => {
        const store = plainStore();
        const values: TPlainSelection[] = [];
        const View = () => {
            const value = useCarburetorValue(store, data => selectPlain(data, order));
            values.push(value);
            return <span>{value.key.id}:{value.index.get(value.key) ?? 'missing'}</span>;
        };
        const {container, unmount} = render(<View/>);

        expect(container.textContent).toBe('1:answer');
        assertPlainAlias(values[values.length - 1], store, 'answer');
        act(() => store.changeId());
        expect(container.textContent).toBe('2:answer');
        act(() => store.changeIndex());
        expect(container.textContent).toBe('2:updated');
        assertPlainAlias(values[values.length - 1], store, 'updated');
        values[values.length - 1].key.id = 99;
        expect(store.getData().key.id).toBe(2);
        unmount();
    });

    test.each(['key-first', 'index-first'] as const)('class selection keeps lookup detached (%s)', order => {
        const store = plainStore();
        let latest: TPlainSelection | undefined;
        class View extends AntiHookComponent {
            private readonly selected = this.connectSelection(() => store, data => selectPlain(data, order));

            render() {
                const value = this.selected();
                latest = value;
                return <span>{value.key.id}:{value.index.get(value.key) ?? 'missing'}</span>;
            }
        }
        const {container, unmount} = render(<View/>);

        expect(container.textContent).toBe('1:answer');
        assertPlainAlias(latest as TPlainSelection, store, 'answer');
        act(() => store.changeId());
        expect(container.textContent).toBe('2:answer');
        act(() => store.changeIndex());
        expect(container.textContent).toBe('2:updated');
        assertPlainAlias(latest as TPlainSelection, store, 'updated');
        (latest as TPlainSelection).key.id = 99;
        expect(store.getData().key.id).toBe(2);
        unmount();
    });
});
