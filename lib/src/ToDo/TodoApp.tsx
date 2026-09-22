import * as React from "react";
import {AntiHookComponent} from "@/Carburetor";
import {EmitStatus} from "./Components/EmitStatus";
import {TodoItem} from "./Components/TodoItem";
import {someCarburetor} from "./Carburetors/SomeCarburetorInstance";
import {TodoCarburetor} from "./Carburetors/TodoCarburetor";

interface ITodoProps {
    carburetor: TodoCarburetor;
}

/**
 * The list reads only the order and the counters. Individual todos are read by the rows,
 * so editing one todo does not re-render the list.
 */
export class TodoApp extends AntiHookComponent<ITodoProps> {
    /** Loads the list once, after the first commit. */
    protected useEffects(): void {
        this.useEffect(this.props.carburetor.loadData, "loadData", []);
    }

    /** The plus icon on the add button. */
    public renderPlusIcon() {
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
     * One counter pill; the values come from the store's derived fields.
     *
     * @param label - the caption before the number, colon included, e.g. 'active:'
     * @param value - undefined until the first emit, and rendered as 0 rather than an empty pill
     * @param tone - the color classes appended after the pill's shared layout classes, verbatim
     * @param testId - the data-testid the demo's tests assert against, one per pill
     */
    public renderCounter(label: string, value: number | undefined, tone: string, testId: string) {
        return (
            <span className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ' + tone}>
                {label}
                <span className="tabular-nums" data-testid={testId}>{value || 0}</span>
            </span>
        );
    }

    /** What the list shows before the first todo exists. */
    public renderEmpty() {
        return (
            <li className="px-5 py-14 text-center text-sm text-slate-400 dark:text-slate-500">
                Nothing here yet — add your first todo
            </li>
        );
    }

    /** Reads the order and the counters only: a todo's own fields are read by its row. */
    public render() {
        const {carburetor} = this.props;

        // Reading through the carburetor: the fields read here become the subscription.
        const {orderIds, activeCount, doneCount} = this.useCarburetor(carburetor);

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
                        {this.renderPlusIcon()}
                    </button>
                </header>

                <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                    {this.renderCounter(
                        'active:',
                        activeCount,
                        'bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
                        'active-count'
                    )}
                    {this.renderCounter(
                        'done:',
                        doneCount,
                        'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
                        'done-count'
                    )}
                </div>

                <ul className="divide-y divide-slate-200/70 border-y dark:divide-slate-800 dark:border-slate-800">
                    {orderIds.length === 0
                        ? this.renderEmpty()
                        : orderIds.map((id: string) => (
                            <TodoItem key={id} carburetor={carburetor} id={id}/>
                        ))}
                </ul>

                <footer className="flex items-center justify-between gap-3 px-5 py-3 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                    <span data-testid="app-renders">
                        list renders: {someCarburetor.printRenderCount()}
                    </span>
                    <EmitStatus/>
                </footer>
            </section>
        );
    }
}
