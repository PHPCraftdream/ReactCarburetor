import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {useCarburetorValue} from '@/Interop';
import {ReadStore} from './ReadStore';

test('R40-02 inline selector coverage builds prefixes once for 1000 missing markers', () => {
    const store = new ReadStore(1000);
    let bump!: () => void;
    const Reader = (): React.ReactElement => {
        const [, setTick] = React.useState(0);
        React.useLayoutEffect(() => { bump = () => setTick(tick => tick + 1); }, []);
        const value = useCarburetorValue(store, data => {
            for (let i = 0; i < 1000; i++) void data.items['r' + i].title;
            return data.items;
        });
        return <p>{value.r999.title}</p>;
    };
    const view = render(<Reader />);
    const starts = rstest.spyOn(String.prototype, 'startsWith');
    const cuts = rstest.spyOn(String.prototype, 'lastIndexOf');
    let prefixOps = 0;
    try {
        act(bump);
        prefixOps = starts.mock.calls.length + cuts.mock.calls.length;
        expect(view.container.textContent).toBe('t999');
    } finally {
        starts.mockRestore(); cuts.mockRestore(); view.unmount();
    }
    expect(prefixOps).toBeGreaterThan(0);
    expect(prefixOps).toBeLessThan(100000);
    expect(store.filed).toHaveLength(1);
});
