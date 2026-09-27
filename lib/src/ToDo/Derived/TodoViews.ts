import {computed, Computed, TComputedReader} from "@/Carburetor";
import {FilterCarburetor} from "@/ToDo/Carburetors/FilterCarburetor";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";

/** The previous array when the ids are the same, so an unchanged result keeps its identity. */
const sameIdsOr = (previous: string[] | undefined, next: string[]): string[] => {
    if (previous && previous.length === next.length && previous.every((id: string, at: number) => id === next[at])) {
        return previous;
    }

    return next;
};

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

    /** The last visibleIds result, reused while the ids stay the same. */
    protected lastIds: string[] | undefined = undefined;

    /**
     * Builds the computeds over one scope's stores.
     *
     * @param todos - the list the values derive from
     * @param filter - the filter visibleIds applies
     */
    constructor(protected todos: TodoCarburetor, protected filter: FilterCarburetor) {
        this.visibleIds = computed<string[]>(this.computeVisibleIds);
        this.progress = computed<number>(this.computeProgress);
        this.summary = computed<string>(this.computeSummary);
    }

    /**
     * Filters the order by completion; the All filter reads no item at all.
     *
     * @param read - records every path the body touches as a dependency
     */
    protected computeVisibleIds = (read: TComputedReader): string[] => {
        const {filter} = read(this.filter);
        const {orderIds, items} = read(this.todos);
        const next = filter === ETodoFilter.All
            ? orderIds.slice()
            : orderIds.filter((id: string) => items[id].done === (filter === ETodoFilter.Done));

        this.lastIds = sameIdsOr(this.lastIds, next);

        return this.lastIds;
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
