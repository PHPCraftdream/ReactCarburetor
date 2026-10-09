/* oxlint-disable react/globals -- Captured render views are intentional test instrumentation. */
import * as React from 'react';
import {render} from '@testing-library/react';
import {IResourceView} from '@/Carburetor/Models/Resource';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

interface IUser {
    id: number;
    name: string;
}

const cases: Array<{label: string; replacement: IUser | undefined; readBefore: boolean}> = [
    {label: 'object before the first data read', replacement: {id: 9, name: 'local'}, readBefore: false},
    {label: 'object after a tracked data read', replacement: {id: 9, name: 'local'}, readBefore: true},
    {label: 'undefined before the first data read', replacement: undefined, readBefore: false},
    {label: 'undefined after a tracked data read', replacement: undefined, readBefore: true},
];

describe('R40-04 hook writable snapshot fields', () => {
    test.each(cases)(
        '$label stays local and the next render restores cache data', async ({replacement, readBefore}) => {
        const original: IUser = {id: 0, name: 'user 0'};
        const calls: number[] = [];
        const cache = new ResourceCache<IUser, number>(async id => {
            calls.push(id);
            return original;
        }, {ttl: Infinity});
        await cache.load(0);
        const entry = cache.getEntry(0);
        const version = cache.getVersion();
        const views: Array<IResourceView<IUser>> = [];
        const Reader = ({tick}: {tick: number}) => {
            const view = useResourceValue(cache, 0);
            views.push(view);
            return <span>{tick}</span>;
        };
        const mounted = render(<Reader tick={0}/>);
        try {
            expect(views).toHaveLength(1);
            const view = views[0];
            if (readBefore) expect(view.data).toEqual(original);

            view.data = replacement;
            view.refreshing = true;
            expect(view.refreshing).toBe(true);
            expect(cache.getEntry(0)).toEqual(entry);
            expect(cache.getEntry(0).data).toEqual(original);
            expect(cache.getEntry(0).refreshing).toBe(false);
            expect(cache.getVersion()).toBe(version);
            expect(view.data).toEqual(replacement);
            expect(view.data?.name).toBe(replacement?.name);
            expect(view.data).toEqual(replacement);

            mounted.rerender(<Reader tick={1}/>);
            expect(views).toHaveLength(2);
            const fresh = views[1];
            expect(fresh).not.toBe(view);
            expect(fresh.data).toEqual(original);
            expect(fresh.data?.name).toBe('user 0');
            expect(fresh.refreshing).toBe(false);
            expect(view.data).toEqual(replacement);
            expect(view.refreshing).toBe(true);
            expect(cache.getEntry(0)).toEqual(entry);
            expect(cache.getVersion()).toBe(version);
            expect(calls).toEqual([0]);
        } finally {
            mounted.unmount();
        }
    });
});
