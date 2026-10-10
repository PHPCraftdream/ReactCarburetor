/* oxlint-disable react/globals -- Captured selections are intentional test instrumentation. */
import * as React from 'react';
import {render} from '@testing-library/react';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

interface IUser {id: number; name: string}
const cases: Array<{label: string; replacement: IUser | undefined; readBefore: boolean}> = [
    {label: 'object before the first data read', replacement: {id: 9, name: 'local'}, readBefore: false},
    {label: 'object after a selected data read', replacement: {id: 9, name: 'local'}, readBefore: true},
    {label: 'undefined before the first data read', replacement: undefined, readBefore: false},
    {label: 'undefined after a selected data read', replacement: undefined, readBefore: true},
];

describe('R40-04 readonly selections with caller-owned overlays', () => {
    test.each(cases)('$label stays local and a later base selection restores cache data',
        async ({replacement, readBefore}) => {
        const original: IUser = {id: 0, name: 'user 0'};
        const calls: number[] = [];
        const cache = new ResourceCache<IUser, number>(async id => {
            calls.push(id);
            return original;
        }, {ttl: Infinity});
        await cache.load(0);
        const entry = cache.getEntry(0);
        const version = cache.getVersion();
        const selections: Array<{readonly data: Readonly<IUser> | undefined; readonly refreshing: boolean}> = [];
        const Reader = ({overlay}: {overlay: boolean}) => {
            const selected = useResourceValue(cache, 0, view => ({data: view.data, refreshing: view.refreshing}));
            selections.push(selected);
            if (readBefore) expect(selected.data).toEqual(original);
            const local = overlay ? {...selected, data: replacement, refreshing: true} : selected;
            return <span>{local.data?.name ?? 'empty'}:{String(local.refreshing)}</span>;
        };
        const mounted = render(<Reader overlay/>);
        try {
            expect(mounted.container.textContent).toBe(`${replacement?.name ?? 'empty'}:true`);
            expect(selections[0].data).toEqual(original);
            expect(cache.getEntry(0)).toEqual(entry);
            expect(cache.getEntry(0).refreshing).toBe(false);
            expect(cache.getVersion()).toBe(version);
            mounted.rerender(<Reader overlay={false}/>);
            expect(mounted.container.textContent).toBe('user 0:false');
            expect(selections[1]).toBe(selections[0]);
            expect(cache.getEntry(0)).toEqual(entry);
            expect(cache.getVersion()).toBe(version);
            expect(calls).toEqual([0]);
        } finally {
            mounted.unmount();
        }
    });
});
