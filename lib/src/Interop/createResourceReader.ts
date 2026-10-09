import {IResourceResolution, IResourceSource} from '@/Carburetor/Models/Resource';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {TPath} from '@/Carburetor/Models/Paths';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {sameReads} from '@/Carburetor/Store/Tracking/Observation/sameReads';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {TCompletedReads} from '@/Carburetor/Store/Tracking/Observation/Models';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

interface ISnapshot<T> {
    resolution: IResourceResolution<T>;
    version: number;
}

/** Creates the mutable external-store adapter owned by one source/path pair.
 * Arguments are observed separately so equivalent argument objects retain subscriptions.
 *
 * @param source - resource entry owner.
 * @param path - canonical entry identity retained by this adapter.
 */
export const createResourceReader = <T, TArgs>(source: IResourceSource<T, TArgs>, path: TPath) => {
    let snapshot: ISnapshot<T> | undefined;
    // Only a committed render may replace the arguments used by notifications.
    // Equivalent arguments keep this reader, but must retire its original object.
    let committed: {args: TArgs} | undefined;
    let reads: TCompletedReads = completeReads(new Set<TPath>());
    let tentative = reads;
    let active: {id: string; reads: TCompletedReads} | undefined;
    let notify: (() => void) | undefined;
    let revision = 0;
    let snapshotRevision = 0;
    const getSnapshot = (): ISnapshot<T> => {
        const version = source.getVersion();
        const drift = (source as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT];
        if (snapshot && snapshotRevision === revision && (snapshot.version === version
            || (drift !== undefined && !drift.call(source, snapshot.version, reads)))) {
            snapshot.version = version;
            return snapshot;
        }
        const next = source.resolve(committed!.args);
        if (snapshot && snapshotRevision === revision && snapshot.resolution.present === false
            && next.view.status === EResourceStatus.Pending
            && !reads.has(joinPath(next.path, 'status'))
            && !reads.has(next.path)
            && snapshot.resolution.view.data === next.view.data
            && snapshot.resolution.view.error === next.view.error
            && snapshot.resolution.view.invalidated === next.view.invalidated
            && snapshot.resolution.view.failed === next.view.failed) {
            snapshot.version = version;
            return snapshot;
        }
        snapshotRevision = revision;
        snapshot = {resolution: next, version};
        return snapshot;
    };
    const install = (next: TCompletedReads): void => {
        reads = next;
        if (!notify) return;
        if (active && sameReads(active.reads, next)) {
            reads = active.reads;
            return;
        }
        if (active) source.unsubscribe(active.id);
        active = {id: source.subscribe(notify, transferCompletedReads(next)), reads: next};
    };
    return {
        path,
        getSnapshot,
        /** Creates an isolated read collector for this render attempt. */
        render(resolution: IResourceResolution<T>) {
            const pending = new Set<TPath>();
            let collecting = true;
            const record = (path: TPath): void => { if (collecting) pending.add(path); };
            const fieldView = resourceReader.view(resolution, record);
            const dataPath = joinPath(resolution.path, 'data');
            let trackedData: {data: T | undefined} | undefined;
            const view = resolution.fieldView === undefined ? fieldView : new Proxy(fieldView, {
                get(target, key, receiver): unknown {
                    if (key !== 'data') return Reflect.get(target, key, receiver);
                    const descriptor = Object.getOwnPropertyDescriptor(target, 'data');
                    if (descriptor && 'value' in descriptor) return descriptor.value;
                    const data = resolution.view.data;
                    if (isTrackable(data)) {
                        trackedData ??= createReadProxy({data}, record, resolution.path);
                        return trackedData.data;
                    }
                    record(dataPath);
                    return data;
                },
            });
            return {
                view,
                pending,
                finish(): TCompletedReads {
                    collecting = false;
                    return completeReads(pending);
                },
            };
        },
        observe(args: TArgs, next?: TCompletedReads): void {
            committed ??= {args};
            if (next === undefined) return;
            tentative = next;
            if (!active) reads = next;
        },
        commit(nextArgs: TArgs, next: TCompletedReads): void {
            committed = {args: nextArgs};
            install(next);
        },
        subscribe(onChange: () => void): () => void {
            notify = onChange;
            install(tentative);
            return () => {
                notify = undefined;
                if (active) source.unsubscribe(active.id);
                active = undefined;
            };
        },
        rearm(): void {
            if (!active || !resourceReader.rearm(source.resolve(committed!.args).view)) return;
            revision++;
            notify?.();
        },
    };
};
