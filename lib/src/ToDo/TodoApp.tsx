import * as React from "react";
import {bind, ScopedAntiHookComponent, TReadonly} from "@/Carburetor";
import {ITodoList} from "./API/Models";
import {EmitStatus} from "./Components/Footer/EmitStatus";
import {ListStatus} from "./Components/Footer/ListStatus";
import {FilterBar} from "./Components/Header/FilterBar";
import {ITodoStats} from "./Components/Header/Models";
import {ProgressBadge} from "./Components/Header/ProgressBadge";
import {StatsSummary} from "./Components/Header/StatsSummary";
import {Toolbar} from "./Components/Header/Toolbar";
import {TodoItem} from "./Components/List/TodoItem";
import {statusToken} from "./Scope/Tokens/statusToken";
import {todoToken} from "./Scope/Tokens/todoToken";
import {undoToken} from "./Scope/Tokens/undoToken";
import {viewsToken} from "./Scope/Tokens/viewsToken";

/** The plus icon on the add button. */
function renderPlusIcon() {
    return (
        <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <path d="M12 5.5v13M5.5 12h13"/>
        </svg>
    );
}

/**
 * Whether a key event belongs to a text field, whose own native undo must win.
 *
 * @param event - the keydown being routed
 */
function isTyping(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;

    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}

/** What the list shows when no todo passes the filter. */
function renderEmpty() {
    return (
        <li className="px-5 py-14 text-center text-sm text-slate-400 dark:text-slate-500">
            Nothing here yet — add your first todo
        </li>
    );
}

/**
 * The counters a stats child needs, as plain data.
 *
 * @param data - the tracked list; the reads here subscribe the owner
 */
function selectStats(data: TReadonly<ITodoList>): ITodoStats {
    return {active: data.activeCount ?? 0, done: data.doneCount ?? 0};
}

/** One row; the row resolves the store itself, id is the map callback's only argument. */
function renderTodoItem(id: string) {
    return <TodoItem key={id} id={id}/>;
}

/**
 * The list reads the filtered ids and a counters snapshot. Individual todos are read by the
 * rows, so editing one todo does not re-render the list. Stores come from the surrounding scope.
 */
export class TodoApp extends ScopedAntiHookComponent {
    /** A detached counters snapshot for the stats child, stable until the counters change. */
    private readonly stats = this.connectSelection(() => this.resolve(todoToken), selectStats);

    /** Loads the list once, and listens for undo keys while mounted. */
    protected useEffects(): void {
        this.useEffect(this.loadList, "loadData", []);
        this.useEffect(this.listenForUndoKeys, "undoKeys", []);
    }

    /** Starts the load; a fresh server list is not something to undo back out of. */
    @bind
    protected loadList(): void {
        void this.resolve(todoToken).loadData().then(this.resolve(undoToken).reset);
    }

    /** Adds the keyboard listener; the returned cleanup removes it on unmount. */
    @bind
    protected listenForUndoKeys(): () => void {
        document.addEventListener('keydown', this.handleUndoKeys);

        return this.stopListeningForUndoKeys;
    }

    /** The effect's cleanup. */
    @bind
    protected stopListeningForUndoKeys(): void {
        document.removeEventListener('keydown', this.handleUndoKeys);
    }

    /**
     * Ctrl/Cmd+Z undoes, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redoes, outside text fields.
     *
     * @param event - the keydown on the document
     */
    @bind
    protected handleUndoKeys(event: KeyboardEvent): void {
        if (!(event.ctrlKey || event.metaKey) || isTyping(event)) {
            return;
        }

        const key = event.key.toLowerCase();
        const undo = this.resolve(undoToken);

        if (key === 'z' && !event.shiftKey) {
            event.preventDefault();
            undo.undo();
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
            event.preventDefault();
            undo.redo();
        }
    }

    /** Reads the visible ids and the counters snapshot: a todo's own fields are read by its row. */
    public render() {
        const carburetor = this.resolve(todoToken);

        // Subscribed to the computed, not to its inputs: it wakes this list only when the ids change.
        const visibleIds = this.useComputed(this.resolve(viewsToken).visibleIds);

        return (
            <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/85 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/30">
                <header className="flex items-start gap-3 border-b border-slate-200/70 px-5 py-4 dark:border-slate-800">
                    <div className="flex-1">
                        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                            Todo list
                        </h1>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            React Carburetor — state outside the tree, not a single hook
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={carburetor.createTodo}
                        aria-label="Add todo"
                        data-testid="add-todo"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 active:scale-95 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-white"
                    >
                        {renderPlusIcon()}
                    </button>
                </header>

                <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <StatsSummary stats={this.stats()}/>
                    <FilterBar/>
                    <ProgressBadge/>
                </div>

                <Toolbar/>

                <ul className="divide-y divide-slate-200/70 border-y dark:divide-slate-800 dark:border-slate-800">
                    {visibleIds.length === 0
                        ? renderEmpty()
                        : visibleIds.map(renderTodoItem)}
                </ul>

                <footer className="flex items-center justify-between gap-3 px-5 py-3 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                    <span data-testid="app-renders">
                        list renders: {this.resolve(statusToken).printRenderCount()}
                    </span>
                    <ListStatus/>
                    <EmitStatus/>
                </footer>
            </section>
        );
    }
}
