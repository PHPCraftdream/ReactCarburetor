import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceResolution, IResourceView} from '@/Carburetor/Models/Resource';
import {TPath, TPathRecorder} from '@/Carburetor/Models/Paths';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';

/** Own view fields whose joined paths are memoized per entry path. */
const FIELD_PATH_FIELDS = ['invalidated', 'failed', 'refreshing', 'updatedAt', 'isIdle', 'status',
    'data', 'error', 'isPending', 'isSuccess', 'isError', 'stale'];

/** Bounded per-path memo of joined field paths; oldest entry evicted past the cap. */
const fieldPathCache = new Map<TPath, Record<string, TPath>>();
const FIELD_PATH_CACHE_CAP = 4096;

/** Returns the frozen per-path record of joined field paths, building it on first use. */
const fieldPaths = (path: TPath): Record<string, TPath> => {
    let record = fieldPathCache.get(path);
    if (record === undefined) {
        if (fieldPathCache.size >= FIELD_PATH_CACHE_CAP) {
            fieldPathCache.delete(fieldPathCache.keys().next().value as TPath);
        }
        record = Object.freeze(Object.fromEntries(
            FIELD_PATH_FIELDS.map(field => [field, joinPath(path, field)])
        )) as Record<string, TPath>;
        fieldPathCache.set(path, record);
    }
    return record;
};

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
        const paths = fieldPaths(path);
        record(paths.invalidated);
        record(paths.failed);
        if (view.invalidated && view.refreshing) {
            record(paths.refreshing);
            record(paths.updatedAt);
        }
        if (present !== false && view.status === EResourceStatus.Pending) {
            // A Pending reader must wake when the request lands back on Idle (abort or
            // supersede teardown) but not when it settles to Success with data: `isIdle`
            // flips only on the former.
            record(paths.isIdle);
        } else if ((present !== false && view.status !== EResourceStatus.Success)
            || (view.invalidated && view.status === EResourceStatus.Pending)) {
            record(paths.status);
        }
    },

    /** The memoized `path.field` string for one entry path and own view field.
     *
     * @param path - captured entry path.
     * @param field - own view field name read through a facade get trap.
     */
    fieldPath(path: TPath, field: string): TPath {
        const paths = fieldPaths(path);
        return paths[field] ?? joinPath(path, field);
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
