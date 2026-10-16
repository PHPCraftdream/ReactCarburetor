// D4 through the component surface: useResource re-requests a stale cache entry after the
// commit, and useCarburetor + a load handle switch answers without extra requests while fresh.
import * as React from 'react';
import {act} from 'react';
import {render, fireEvent} from '@testing-library/react';
import {AntiHookComponent, ResourceCarburetor} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

const sleep = async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, ms));
};

const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

interface IRowProps {
    cache: ResourceCache<string, [string]>;
    id: string;
    // shouldComponentUpdate shallow-compares props: a changed tick lets the rerender through.
    tick: number;
}

class Row extends AntiHookComponent<IRowProps> {
    public render() {
        const entry = this.useResource(this.props.cache, this.props.id);
        return <span>{entry.data || entry.status}</span>;
    }
}

describe('stale reads through components (D4)', () => {
    test('useResource re-requests a stale cache entry after the commit', async () => {
        const calls: string[] = [];
        const cache = new ResourceCache<string, [string]>(async id => {
            calls.push(id);
            return `value-${id}`;
        }, {ttl: 40});

        const mounted = render(<Row cache={cache} id="a" tick={0}/>);
        try {
            await flush();
            expect(calls).toEqual(['a']);
            expect(mounted.container.textContent).toBe('value-a');

            // Past the ttl the entry is stale: the next render queues a load for after commit.
            await sleep(60);
            mounted.rerender(<Row cache={cache} id="a" tick={1}/>);
            await flush();
            expect(calls).toEqual(['a', 'a']);
            expect(mounted.container.textContent).toBe('value-a');
        } finally { mounted.unmount(); }
    });

    test('useCarburetor + load handle: fresh switching is free, stale switching requests', async () => {
        const calls: string[] = [];
        const slot = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        }, {ttl: 40});

        const Clicker = ({id}: {id: string}) => (
            <button onClick={() => void slot.load(id)}>{slot.getData().data || slot.getData().status}</button>
        );
        class Reader extends AntiHookComponent<{slot: ResourceCarburetor<string, [string]>}> {
            public render() {
                const data = this.useCarburetor(this.props.slot);
                return <span>{data.data || data.status}</span>;
            }
        }

        const mounted = render(
            <div><Reader slot={slot}/><Clicker id="a"/></div>,
        );
        try {
            // The handler, not the mount, starts each request: switch a -> b -> a while fresh.
            const switchTo = async (id: string): Promise<void> => {
                mounted.rerender(<div><Reader slot={slot}/><Clicker id={id}/></div>);
                await act(async () => { fireEvent.click(mounted.container.querySelector('button')!); });
                await flush();
            };

            await switchTo('a');
            expect(calls).toEqual(['a']);
            await switchTo('b');
            expect(calls).toEqual(['a', 'b']);
            await switchTo('a');
            // Fresh remembered answers cost no requests.
            expect(calls).toEqual(['a', 'b']);

            // Past the ttl the remembered 'a' is stale: the click requests again.
            await sleep(60);
            await switchTo('a');
            expect(calls).toEqual(['a', 'b', 'a']);
        } finally { mounted.unmount(); }
    });
});
