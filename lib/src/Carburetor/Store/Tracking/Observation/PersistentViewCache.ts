import {TReadonly} from '@/Carburetor/Models/Base';
import {TPath} from '@/Carburetor/Models/Paths';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';

/** A source able to mint a tracked view, with a data object whose identity can be checked. */
interface IViewSource<T> {
    read: (record: (path: TPath) => void) => TReadonly<T>;
    getData?: () => T;
}

/**
 * One persistent view per source, rebuilt only when the store's data object changes — the
 * `buildTrackedView` rule. The recorder reads caller-owned mutable state, so a view captured
 * by an earlier run and read after the current one is attributed to whatever the caller
 * currently points at: at worst an extra recorded path, never a missed one.
 */
export class PersistentViews {
    /** The view built for each source and the data object it wraps. */
    private readonly entries = new WeakMap<object, {data: unknown; view: TReadonly<unknown>}>();

    /** Returns the source's persistent view, rebuilding it when its data object changed.
     *
     * @param source - the tracked read source.
     * @param route - receives every path the view reads.
     */
    public view<T>(source: IViewSource<T>, route: (path: TPath) => void): TReadonly<T> {
        if (source.getData === undefined) {
            return source.read(route);
        }

        const data = source.getData();

        if (!isTrackable(data)) {
            return source.read(route);
        }

        const cached = this.entries.get(source);

        if (cached !== undefined && cached.data === data) {
            return cached.view as TReadonly<T>;
        }

        const view = source.read(route);
        this.entries.set(source, {data, view});

        return view;
    }
}
