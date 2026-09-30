import * as React from "react";
import {bind, EResourceStatus, ScopedAntiHookComponent} from "@/Carburetor";
import {detailsToken} from "@/ToDo/Scope/Tokens/detailsToken";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";
import {undoToken} from "@/ToDo/Scope/Tokens/undoToken";

const BUTTON = 'rounded-md px-2 py-0.5 font-medium text-slate-600 transition hover:bg-slate-200/70 '
    + 'dark:text-slate-300 dark:hover:bg-slate-700/60';

/**
 * The list request's own status — loading, failed, synced — read from its ResourceCarburetor,
 * so the list component never re-renders for a request going pending.
 */
export class ListStatus extends ScopedAntiHookComponent {
    /** The request store owned by the todo list, resolved from the scope. */
    private readonly request = this.connect(() => this.resolve(todoToken).list);

    /** Reloads from the server; cached details go stale and refetch where they are on screen. */
    @bind
    public handleReload(): void {
        void this.resolve(todoToken).loadData().then(this.resolve(undoToken).reset);
        this.resolve(detailsToken).invalidateAll();
    }

    /** Cancels the request in flight; the list keeps what it had. */
    @bind
    public handleCancel(): void {
        this.resolve(todoToken).abortLoad();
    }

    /** Reads only the request's status, error and timestamp. */
    public render() {
        const {status, error, updatedAt} = this.request;

        if (status === EResourceStatus.Pending) {
            return (
                <span className="flex items-center gap-2" data-testid="list-status">
                    Loading…
                    <button type="button" onClick={this.handleCancel} className={BUTTON} data-testid="list-cancel">
                        cancel
                    </button>
                </span>
            );
        }

        const label = status === EResourceStatus.Error
            ? 'Load failed: ' + error
            : status === EResourceStatus.Success && updatedAt
                ? 'Synced ' + new Date(updatedAt).toLocaleTimeString()
                : 'Not loaded';

        return (
            <span className="flex items-center gap-2" data-testid="list-status">
                {label}
                <button type="button" onClick={this.handleReload} className={BUTTON} data-testid="list-reload">
                    reload
                </button>
            </span>
        );
    }
}
