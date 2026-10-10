"use client";

import {useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';
import {TReadonly} from '@/Carburetor/Models/Base';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
import {IS_DEVELOPMENT} from '@/Carburetor/Store/Utils/DevelopmentFlag';
import {diagnostics} from '@/Carburetor/Store/Diagnostics/DiagnosticsInstance';
import {TSelector, TValueComparator} from './Models';
import {createResourceReader} from './createResourceReader';

/** Selects a detached readonly resource value; automatic loading starts only after attachment.
 * The pure synchronous selector borrows an evaluation-scoped input. Children observe only the
 * selected graph: their reads do not collect dependencies. Hoist selectors for cached parent reads.
 *
 * @param source - resource entry owner.
 * @param args - immutable loader arguments identifying the canonical entry.
 * @param select - required synchronous selection of the fields the consumer renders.
 * @param isEqual - optional detached-value comparator; true retains the previous result.
 */
export const useResourceValue = <T, TArgs, R>(
    source: IResourceSource<T, TArgs>, args: TArgs,
    select: TSelector<IResourceView<T>, R>, isEqual?: TValueComparator<R>
): TReadonly<R> => {
    // Resolve even on cached parent reads: TTL freshness need not change the source version.
    const resolution = source.resolve(args);
    const reader = useMemo(() => createResourceReader<T, TArgs, R>(source, resolution.path), [source, resolution.path]);
    const candidate = reader.evaluate(args, resolution, select, isEqual);
    const getSnapshot = useCallback(() => reader.getSnapshot(candidate), [reader, candidate]);
    useSyncExternalStore(reader.subscribe, getSnapshot, getSnapshot);
    const renderVersion = source.getVersion();
    useInsertionEffect(() => {
        if (IS_DEVELOPMENT && resourceReader.worthFetching(resolution.view)
            && source.getVersion() !== renderVersion) {
            const current = source.resolve(args).view;
            if (current.refreshing || current.status === EResourceStatus.Pending) {
                diagnostics.report('load() started during a useResourceValue() render; defer resource loads to an effect.');
            }
        }
    });
    // Publish this exact render's record, not a reader-wide latest speculative slot.
    useLayoutEffect(() => { reader.commit(candidate); });
    useEffect(() => { reader.load(); });
    return candidate.value as TReadonly<R>;
};
