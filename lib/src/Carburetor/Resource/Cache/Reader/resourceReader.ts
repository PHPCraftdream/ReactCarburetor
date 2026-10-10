import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceResolution, IResourceView} from '@/Carburetor/Models/Resource';
import {TPathRecorder} from '@/Carburetor/Models/Paths';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';

/** Decisions shared by committed resource readers. */
export const resourceReader = {
    /** Records automatic retry dependencies without allocating a writable field facade.
     *
     * @param resolution - captured resource resolution.
     * @param record - records engine dependencies.
     */
    collect<T>(resolution: IResourceResolution<T>, record: TPathRecorder): void {
        const {path, view, fieldView, present} = resolution;
        if (fieldView === undefined) { record(path); return; }
        record(joinPath(path, 'invalidated'));
        record(joinPath(path, 'failed'));
        if (view.invalidated && view.refreshing) {
            record(joinPath(path, 'refreshing'));
            record(joinPath(path, 'updatedAt'));
        }
        if ((present !== false && view.status !== EResourceStatus.Success)
            || (view.invalidated && view.status === EResourceStatus.Pending)) {
            record(joinPath(path, 'status'));
        }
    },

    /** Builds the class field facade and records the automatic retry dependencies.
     *
     * @param resolution - captured resource resolution.
     * @param record - records reads for this class render attempt.
     */
    view<T>(resolution: IResourceResolution<T>, record: TPathRecorder): IResourceView<T> {
        resourceReader.collect(resolution, record);
        return resolution.fieldView === undefined ? resolution.view : resolution.fieldView(resolution, record);
    },

    /** Whether a committed render should start a deferred load. */
    worthFetching<T>(view: IResourceView<T>): boolean {
        return view.stale && !view.refreshing && !view.failed
            && (view.status !== EResourceStatus.Error || view.invalidated);
    },

    /** Whether an invalidation survived the request that just settled. */
    rearm<T>(view: IResourceView<T>): boolean {
        return view.invalidated && view.stale && !view.refreshing && !view.failed;
    },
};
