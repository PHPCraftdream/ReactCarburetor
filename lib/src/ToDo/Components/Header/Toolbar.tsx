import * as React from "react";
import {bind, ScopedAntiHookComponent, transaction} from "@/Carburetor";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";
import {filterToken} from "@/ToDo/Scope/Tokens/filterToken";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";
import {undoToken} from "@/ToDo/Scope/Tokens/undoToken";

const BUTTON = 'rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200/70 '
    + 'disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/60';

/** Bulk actions and undo/redo; it reads only the undo store's two flags. */
export class Toolbar extends ScopedAntiHookComponent {
    /** canUndo/canRedo, published by the undo store. */
    private readonly undo = this.connect(() => this.resolve(undoToken));

    /** Marks everything done in a single update. */
    @bind
    public handleCompleteAll(): void {
        this.resolve(todoToken).completeAll();
    }

    /**
     * Removes the done todos and returns to the All filter: two stores, one notification pass,
     * so no component renders the in-between state.
     */
    @bind
    public handleClearCompleted(): void {
        transaction(this.clearCompletedAndShowAll);
    }

    /** Steps the list one change back. */
    @bind
    public handleUndo(): void {
        this.resolve(undoToken).undo();
    }

    /** Steps one undone change forward. */
    @bind
    public handleRedo(): void {
        this.resolve(undoToken).redo();
    }

    /** The writes the transaction groups. */
    @bind
    protected clearCompletedAndShowAll(): void {
        this.resolve(todoToken).clearCompleted();
        this.resolve(filterToken).setFilter(ETodoFilter.All);
    }

    /** Reads the two undo flags only. */
    public render() {
        const {canUndo, canRedo} = this.undo;

        return (
            <div className="flex flex-wrap items-center gap-1 px-5 pb-3">
                <button type="button" onClick={this.handleCompleteAll} className={BUTTON} data-testid="complete-all">
                    complete all
                </button>
                <button type="button" onClick={this.handleClearCompleted} className={BUTTON} data-testid="clear-completed">
                    clear completed
                </button>
                <span className="flex-1"/>
                <button
                    type="button"
                    onClick={this.handleUndo}
                    disabled={!canUndo}
                    className={BUTTON}
                    title="Ctrl+Z"
                    data-testid="undo"
                >
                    undo
                </button>
                <button
                    type="button"
                    onClick={this.handleRedo}
                    disabled={!canRedo}
                    className={BUTTON}
                    title="Ctrl+Y"
                    data-testid="redo"
                >
                    redo
                </button>
            </div>
        );
    }
}
