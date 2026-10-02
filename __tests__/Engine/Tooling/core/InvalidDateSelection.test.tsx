import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

interface IDateData {
    marker: number;
    date: Date;
}

describe('Invalid Date selection snapshots (R31-05)', () => {
    test('watch suppresses equal invalid dates and reports each valid transition', () => {
        const store = new Carburetor<IDateData>({marker: 0, date: new Date(Number.NaN)});
        const seen: Array<{parity: number; time: number}> = [];
        const stop = store.watch(data => ({parity: data.marker % 2, date: data.date}), next => {
            seen.push({parity: next.parity, time: next.date.getTime()});
        });

        store.setData({marker: 2, date: new Date(Number.NaN)});
        expect(seen).toEqual([]);

        store.setData({marker: 4, date: new Date(0)});
        expect(seen).toEqual([{parity: 0, time: 0}]);

        store.setData({marker: 6, date: new Date(Number.NaN)});
        expect(seen).toHaveLength(2);
        expect(Number.isNaN(seen[1].time)).toBe(true);

        store.setData({marker: 8, date: new Date(1)});
        expect(seen[2]).toEqual({parity: 0, time: 1});

        stop();
    });

    test('the hook keeps the same invalid snapshot and renders valid time changes', async () => {
        const store = new Carburetor<IDateData>({marker: 0, date: new Date(Number.NaN)});
        let renders = 0;

        const DateView = () => {
            renders++;
            const selection = useCarburetorValue(store, data => ({
                parity: data.marker % 2,
                date: data.date,
            }));

            return <span>{selection.parity}:{selection.date.getTime()}</span>;
        };

        const {container, unmount} = render(<DateView />);

        expect(container.textContent).toBe('0:NaN');
        expect(renders).toBe(1);

        await act(async () => { store.setData({marker: 2, date: new Date(Number.NaN)}); });
        expect(container.textContent).toBe('0:NaN');
        expect(renders).toBe(1);

        await act(async () => { store.setData({marker: 4, date: new Date(0)}); });
        expect(container.textContent).toBe('0:0');
        expect(renders).toBe(2);

        await act(async () => { store.setData({marker: 6, date: new Date(Number.NaN)}); });
        expect(container.textContent).toBe('0:NaN');
        expect(renders).toBe(3);

        await act(async () => { store.setData({marker: 8, date: new Date(1)}); });
        expect(container.textContent).toBe('0:1');
        expect(renders).toBe(4);

        unmount();
    });
});
