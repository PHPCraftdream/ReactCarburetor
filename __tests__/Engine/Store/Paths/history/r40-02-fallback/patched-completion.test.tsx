import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';
import {TSubscriber} from '@/Carburetor/Models/Base';

interface IData {tick: number; items: {title: string}[]}
class Store extends Carburetor<IData> {
    public filed: ReadonlySet<string>[] = [];
    public recorded = 0;
    public change(body: (data: IData) => void): void { this.update(body); }
    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read(path => { this.recorded++; record(path); });
    }
    public override subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        if (options.reads) this.filed.push(options.reads);
        return super.subscribe(callback, options);
    }
}
const select = (data: Readonly<IData>): IData['items'] => data.items;

for (const route of ['watch', 'hook']) {
    test(`R40-02 ${route} patch closes scratch, not the retained 1000-row read set`, () => {
        const store = new Store({tick: 0, items: Array.from({length: 1000}, () => ({title: 'initial'}))});
        let delivered = 0;
        let latest = '';
        let stop: () => void;
        if (route === 'watch') {
            stop = store.watch(select, value => { delivered++; latest = value[7].title; });
        } else {
            const Reader = (): React.ReactElement => {
                const value = useCarburetorValue(store, select);
                React.useLayoutEffect(() => { delivered++; latest = value[7].title; }, [value]);
                return <p>{value[7].title}</p>;
            };
            const view = render(<Reader />);
            stop = () => view.unmount();
        }
        const retained = store.filed[0];
        const original = [...retained];
        const before = delivered;
        store.recorded = 0;
        const ends = rstest.spyOn(String.prototype, 'endsWith');
        const cuts = rstest.spyOn(String.prototype, 'lastIndexOf');
        let operations = 0;
        try {
            act(() => {
                store.change(data => { data.tick++; });
                store.change(data => { data.tick++; });
                store.change(data => { data.items[7].title = 'edited'; });
            });
            operations = ends.mock.calls.length + cuts.mock.calls.length;
        } finally { ends.mockRestore(); cuts.mockRestore(); }
        expect(latest).toBe('edited');
        expect(delivered).toBe(before + 1);
        expect(store.recorded).toBeLessThan(20);
        expect(store.filed).toHaveLength(1);
        expect([...retained]).toEqual(original);
        stop();
        expect(operations).toBeLessThan(300);
    });
}
