import * as React from "react";
import {bind, EResourceStatus, ScopedAntiHookComponent} from "@/Carburetor";
import {detailsToken} from "@/ToDo/Scope/Tokens/detailsToken";

interface ITodoDetailsProps {
    id: string;
}

/**
 * One todo's server details from the ResourceCache: subscribed to this entry alone, fetched
 * after the commit when missing or stale, refreshed in place without flashing a spinner.
 */
export class TodoDetails extends ScopedAntiHookComponent<ITodoDetailsProps> {
    /** Refetches this entry; the old data stays on screen while it runs. */
    @bind
    public handleRefresh(): void {
        void this.resolve(detailsToken).refresh(this.props.id);
    }

    /** Reads the entry for this id; another id's answer does not re-render this panel. */
    public render() {
        const entry = this.useResource(this.resolve(detailsToken), this.props.id);

        let body: React.ReactNode;

        if (entry.status === EResourceStatus.Error) {
            body = 'Details failed: ' + entry.error;
        } else if (entry.data === undefined) {
            body = 'Loading details…';
        } else {
            body = '≈ ' + entry.data.estimateMinutes + ' min · checked '
                + new Date(entry.data.checkedAt).toLocaleTimeString()
                + (entry.refreshing ? ' · refreshing…' : '');
        }

        return (
            <div
                className="flex items-center gap-2 px-5 pb-3 pl-13 text-xs text-slate-500 dark:text-slate-400"
                data-testid="todo-details"
            >
                <span className="flex-1" data-testid="todo-details-body">{body}</span>
                <button
                    type="button"
                    onClick={this.handleRefresh}
                    className="rounded-md px-2 py-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
                    data-testid="todo-details-refresh"
                >
                    refresh
                </button>
            </div>
        );
    }
}
