import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {Carburetor} from "@/Carburetor";
import {useCarburetorValue} from "@/Interop";
import {READS_TRANSFER} from "@/Carburetor/Store/Paths/Markers/ReadsTransferBrand";

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public bump = () => {
        this.draft.count += 1;

        this.emitUpdate();
    };
}

interface IBoxData {
    box: {count: number};
}

class BoxCarburetor extends Carburetor<IBoxData> {
    public bump = () => {
        this.draft.box.count += 1;

        this.emitUpdate();
    };
}

interface ITwoBranchData {
    box: {count: number};
    other: {value: number};
}

class TwoBranchCarburetor extends Carburetor<ITwoBranchData> {
    public bumpBox = () => {
        this.draft.box.count += 1;

        this.emitUpdate();
    };

    public bumpOther = () => {
        this.draft.other.value += 1;

        this.emitUpdate();
    };
}

/** The store itself can be untrackable: then read() hands back raw data, no proxy involved. */
class MapRootCarburetor extends Carburetor<Map<string, number>> {
    public setKey = (key: string, value: number) => {
        this.update((draft: Map<string, number>) => {
            // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
            draft.set(key, value);
        });
    };
}

describe('useCarburetorValue persistent root view', () => {
    test('an inline selector recreated every render reads the store at most once while data is unchanged', () => {
        const carburetor = new CounterCarburetor({count: 0});
        const readSpy = rstest.spyOn(carburetor, 'read');

        const View = ({tick}: {tick: number}) => {
            // A fresh closure every render: the entry cache keyed on selector identity must miss.
            const value = useCarburetorValue(carburetor, (data) => data.count);

            return <div className="value">{value}:{tick}</div>;
        };

        const {container, rerender, unmount} = render(<View tick={0}/>);

        for (let tick = 1; tick <= 5; tick++) {
            rerender(<View tick={tick}/>);
        }

        expect(container.querySelector('.value')?.textContent).toEqual('0:5');
        expect(readSpy).toHaveBeenCalledTimes(1);

        unmount();
    });

    test('a nested branch selector reuses the same cached proxy and still compares by value', () => {
        const carburetor = new BoxCarburetor({box: {count: 1}});
        const readSpy = rstest.spyOn(carburetor, 'read');
        const seen: Array<{count: number}> = [];

        const View = ({tick}: {tick: number}) => {
            const value = useCarburetorValue(carburetor, (data) => data.box);

            seen.push(value);

            return <div className="value">{value.count}:{tick}</div>;
        };

        const {rerender, unmount} = render(<View tick={0}/>);

        rerender(<View tick={1}/>);
        rerender(<View tick={2}/>);

        // The default comparator matches by value, not by the (now cached) branch proxy's
        // identity: every render hands back the same detached snapshot.
        expect(seen[1]).toBe(seen[0]);
        expect(seen[2]).toBe(seen[0]);
        expect(readSpy).toHaveBeenCalledTimes(1);

        act(() => carburetor.bump());

        expect(seen[seen.length - 1]).not.toBe(seen[0]);
        expect(seen[seen.length - 1].count).toEqual(2);

        unmount();
    });

    test('setData rebuilds the view and the hook sees the new data', () => {
        const carburetor = new CounterCarburetor({count: 1});

        const View = () => {
            const value = useCarburetorValue(carburetor, (data) => data.count);

            return <div className="value">{value}</div>;
        };

        const {container, unmount} = render(<View/>);

        expect(container.querySelector('.value')?.textContent).toEqual('1');

        act(() => {
            carburetor.setData({count: 9});
        });

        expect(container.querySelector('.value')?.textContent).toEqual('9');

        unmount();
    });

    test('a live value read outside getSnapshot records nothing into the subscription', () => {
        const carburetor = new TwoBranchCarburetor({box: {count: 1}, other: {value: 1}});
        let capturedRoot: ITwoBranchData | null = null;
        let renders = 0;

        const View = () => {
            renders++;

            const boxCount = useCarburetorValue(carburetor, (data) => {
                // Stashes the persistent live view itself, not a value read through it: the
                // stash is not a read, so it never touches the recorder.
                capturedRoot = data;

                return data.box.count;
            });

            React.useEffect(() => {
                // Runs after commit — strictly outside any getSnapshot call — so this read of a
                // branch the selector never touched must not extend the subscription.
                void capturedRoot?.other.value;
            });

            return <div className="value">{boxCount}</div>;
        };

        const {container, unmount} = render(<View/>);

        const afterMount = renders;

        // Only a bug would have subscribed to `other`: the selector itself never reads it.
        act(() => carburetor.bumpOther());

        expect(renders).toEqual(afterMount);
        expect(container.querySelector('.value')?.textContent).toEqual('1');

        act(() => carburetor.bumpBox());

        expect(renders).toBeGreaterThan(afterMount);
        expect(container.querySelector('.value')?.textContent).toEqual('2');

        unmount();
    });

    test('a non-trackable root (a Map) is read correctly and still re-renders on writes', () => {
        const carburetor = new MapRootCarburetor(new Map([['a', 1]]));
        let renders = 0;

        const View = () => {
            renders++;

            const value = useCarburetorValue(carburetor, (data) => data.get('a'));

            return <div className="value">{value}</div>;
        };

        const {container, unmount} = render(<View/>);

        expect(container.querySelector('.value')?.textContent).toEqual('1');
        const afterMount = renders;

        act(() => carburetor.setKey('a', 2));

        expect(renders).toBeGreaterThan(afterMount);
        expect(container.querySelector('.value')?.textContent).toEqual('2');

        unmount();
    });

    test('transfers its read set into subscribe(), not a copy (R6-04)', () => {
        const carburetor = new CounterCarburetor({count: 1});
        const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

        const View = () => {
            const value = useCarburetorValue(carburetor, (data) => data.count);

            return <div className="value">{value}</div>;
        };

        const {unmount} = render(<View/>);

        const options = subscribeSpy.mock.calls[0][1] as {reads?: unknown; [READS_TRANSFER]?: unknown};

        expect(options[READS_TRANSFER]).toBe(options.reads);

        unmount();
        subscribeSpy.mockRestore();
    });
});
