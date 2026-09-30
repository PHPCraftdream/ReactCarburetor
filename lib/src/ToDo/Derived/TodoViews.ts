import {computed, Computed, shallowEqual, TComputedReader} from "@/Carburetor";
import {FilterCarburetor} from "@/ToDo/Carburetors/FilterCarburetor";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";

/**
 * Values derived from the list and the filter. Each computed reads only what it needs, so
 * editing a title recomputes none of them, and a recompute that lands on the same result wakes
 * nobody.
 */
export class TodoViews {
    /** The ids the list shows under the current filter, in display order. */
    public readonly visibleIds: Computed<string[]>;

    /** Share of todos done, 0–100. */
    public readonly progress: Computed<number>;

    /** A one-line summary, composed from `progress` through the reader. */
    public readonly summary: Computed<string>;

    /**
     * Builds the computeds over one scope's stores.
     *
     * @param todos - the list the values derive from
     * @param filter - the filter visibleIds applies
     */
    constructor(protected todos: TodoCarburetor, protected filter: FilterCarburetor) {
        this.visibleIds = computed<string[]>(this.computeVisibleIds, {equals: shallowEqual});
        this.progress = computed<number>(this.computeProgress);
        this.summary = computed<string>(this.computeSummary);
    }

    /**
     * Filters the order by completion; the All filter reads no item at all.
     *
     * `visibleIds` is built with `{equals: shallowEqual}`, so a filter or completion write
     * that leaves these ids the same wakes nobody, even though `filter`/`slice` return a new
     * array every time.
     *
     * @param read - records every path the body touches as a dependency
     */
    protected computeVisibleIds = (read: TComputedReader): string[] => {
        const {filter} = read(this.filter);
        const {orderIds, items} = read(this.todos);

        return filter === ETodoFilter.All
            ? orderIds.slice()
            : orderIds.filter((id: string) => items[id].done === (filter === ETodoFilter.Done));
    };

    /**
     * Reads the two counters the list keeps current.
     *
     * @param read - records every path the body touches as a dependency
     */
    protected computeProgress = (read: TComputedReader): number => {
        const {doneCount = 0, activeCount = 0} = read(this.todos);
        const total = doneCount + activeCount;

        return total === 0 ? 0 : Math.round(doneCount * 100 / total);
    };

    /**
     * Reads another computed through the reader, which is what records it as a dependency.
     *
     * @param read - records every path the body touches as a dependency
     */
    protected computeSummary = (read: TComputedReader): string => {
        return read(this.progress) + '% done';
    };
}
