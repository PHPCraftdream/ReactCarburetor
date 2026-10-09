import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceResolution, IResourceView} from '@/Carburetor/Models/Resource';

/** Decisions shared by committed resource readers. */
export const resourceReader = {
    /** Builds the field view and records the automatic retry dependencies. */
    view<T>(resolution: IResourceResolution<T>, record: (path: string) => void): IResourceView<T> {
        const {path, view, fieldView, present} = resolution;
        if (fieldView === undefined) {
            record(path);
            return view;
        }
        const readerView = fieldView(record);
        void readerView.invalidated;
        void readerView.failed;
        if (view.invalidated && view.refreshing) {
            void readerView.refreshing;
        }
        if ((present !== false && view.status !== EResourceStatus.Success)
            || (view.invalidated && view.status === EResourceStatus.Pending)) {
            void readerView.status;
        }
        return readerView;
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
