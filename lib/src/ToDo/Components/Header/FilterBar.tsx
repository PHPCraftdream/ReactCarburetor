import * as React from "react";
import {bind, ScopedAntiHookComponent} from "@/Carburetor";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";
import {filterToken} from "@/ToDo/Scope/Tokens/filterToken";

/**
 * One filter tab.
 *
 * @param label - the tab caption
 * @param active - whether this tab is the current filter
 * @param onClick - selects this tab's filter
 * @param testId - test selector
 */
function renderTab(label: string, active: boolean, onClick: () => void, testId: string) {
    const tone = active
        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
        : 'text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700/60';

    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            data-testid={testId}
            className={'rounded-full px-3 py-1 text-xs font-medium transition ' + tone}
        >
            {label}
        </button>
    );
}

/** The filter tabs; they read the filter store alone. */
export class FilterBar extends ScopedAntiHookComponent {
    /** The filter store of this scope. */
    private readonly settings = this.connect(() => this.resolve(filterToken));

    /** Shows every todo. */
    @bind
    public handleAll(): void {
        this.resolve(filterToken).setFilter(ETodoFilter.All);
    }

    /** Shows the todos still to do. */
    @bind
    public handleActive(): void {
        this.resolve(filterToken).setFilter(ETodoFilter.Active);
    }

    /** Shows the finished todos. */
    @bind
    public handleDone(): void {
        this.resolve(filterToken).setFilter(ETodoFilter.Done);
    }

    /** Reads the current filter only. */
    public render() {
        const {filter} = this.settings;

        return (
            <div className="flex items-center gap-1" role="group" aria-label="Filter">
                {renderTab('all', filter === ETodoFilter.All, this.handleAll, 'filter-all')}
                {renderTab('active', filter === ETodoFilter.Active, this.handleActive, 'filter-active')}
                {renderTab('done', filter === ETodoFilter.Done, this.handleDone, 'filter-done')}
            </div>
        );
    }
}
