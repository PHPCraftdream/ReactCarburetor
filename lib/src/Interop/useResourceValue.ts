"use client";

import {useEffect, useInsertionEffect, useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {IS_DEVELOPMENT} from '@/Carburetor/Store/Utils/DevelopmentFlag';
import {diagnostics} from '@/Carburetor/Store/Diagnostics/DiagnosticsInstance';
import {createResourceReader} from './createResourceReader';

/** Reads a resource's rendered fields and defers stale loads until after commit.
 *
 * @param source - resource entry owner.
 * @param args - loader arguments identifying the entry.
 */
export const useResourceValue = <T, TArgs>(
    source: IResourceSource<T, TArgs>,
    args: TArgs
): IResourceView<T> => {
    const resolution = source.resolve(args);
    // Canonical paths, not argument object identity, own the external-store subscription.
    // Each render observes its arguments; only commit replaces notification arguments.
    const reader = useMemo(() => createResourceReader(source, resolution.path), [source, resolution.path]);
    reader.observe(args);
    // The external-store snapshot is a stable notification token, not the render
    // view: unread fields and TTL freshness can change without changing this token.
    useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
    const renderVersion = source.getVersion();
    const {view, pending, finish} = reader.render(resolution);
    reader.observe(args, completeReads(pending));
    // This boundary precedes layout effects (including class didMount loads).
    // It only diagnoses changes since render; it installs nothing and starts no work.
    useInsertionEffect(() => {
        if (IS_DEVELOPMENT && resourceReader.worthFetching(resolution.view)
            && source.getVersion() !== renderVersion) {
            const current = source.resolve(args).view;
            if (current.refreshing || current.status === EResourceStatus.Pending) {
                diagnostics.report('load() started during a useResourceValue() render; defer resource loads to an effect.');
            }
        }
    });
    useLayoutEffect(() => {
        reader.commit(args, finish());
    });
    useEffect(() => {
        if (!resourceReader.worthFetching(resolution.view)) return;
        const loading = source.load(args);
        if (resolution.fieldView === undefined) {
            void loading;
            return;
        }
        void loading.then(() => reader.rearm());
    }, [source, args, reader, resolution]);
    return view;
};
