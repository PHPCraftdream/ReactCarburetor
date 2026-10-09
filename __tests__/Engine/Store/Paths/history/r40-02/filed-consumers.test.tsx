import * as React from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, computed} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {ReadStore} from './ReadStore';

describe('R40-02 filed consumer paths', () => {
    test('hook row files one leaf', () => {
        const store = new ReadStore();
        const Row = (): React.ReactElement => <p>{useCarburetorValue(store, d => d.items.r1.title)}</p>;
        const view = render(<Row />);
        try {
            expect(view.container.textContent).toBe('t1');
            expect(store.filed.at(-1)).toEqual(['items.r1.title']);
        } finally { view.unmount(); }
    });

    test('class connect row files two leaves', () => {
        const store = new ReadStore();
        class Row extends AntiHookComponent {
            private readonly data = this.connect(store);
            public render(): React.ReactNode {
                const row = this.data.items.r1;
                return <p>{row.title} {row.owner.name}</p>;
            }
        }
        const view = render(<Row />);
        try {
            expect(view.container.textContent).toBe('t1 n1');
            expect(store.filed.at(-1)).toEqual(['items.r1.title', 'items.r1.owner.name']);
        } finally { view.unmount(); }
    });

    test('watch files one leaf', () => {
        const store = new ReadStore();
        const stop = store.watch(d => d.items.r2.done, () => {});
        try { expect(store.filed.at(-1)).toEqual(['items.r2.done']); }
        finally { stop(); }
    });

    test('computed files two leaves without traversal markers', () => {
        const store = new ReadStore();
        const value = computed(read => read(store).items.r1.owner.name.length + read(store).filter.text.length);
        const id = value.subscribe(() => {});
        try {
            expect(value.get()).toBe(2);
            expect(store.filed.at(-1)).toEqual(['items.r1.owner.name', 'filter.text']);
        } finally { value.unsubscribe(id); }
    });

    test('README activeCount files 1001 paths over 1000 items', () => {
        const store = new ReadStore(1000);
        const activeCount = computed<number>(read => {
            const {items} = read(store);
            return Object.keys(items).filter(id => !items[id].done).length;
        });
        const id = activeCount.subscribe(() => {});
        try {
            expect(activeCount.get()).toBe(666);
            const paths = store.filed.at(-1)!;
            expect(paths).toHaveLength(1001);
            expect(new Set(paths)).toEqual(new Set([
                'items.~k', ...Array.from({length: 1000}, (_, i) => `items.r${i}.done`),
            ]));
        } finally { activeCount.unsubscribe(id); }
    });
});
