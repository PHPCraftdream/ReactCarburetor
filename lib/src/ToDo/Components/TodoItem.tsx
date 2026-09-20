import * as React from "react";
import {AntiHookComponent} from "../../Carburetor";
import {TodoCarburetor} from "../TodoCarburetor";

interface ITodoItemProps {
    carburetor: TodoCarburetor;
    id: string;
}

/**
 * A row subscribes to its own todo: it reads `items.<id>` and nothing else.
 * That is why editing one todo re-renders one row instead of the whole list.
 */
export class TodoItem extends AntiHookComponent<ITodoItemProps> {
    /** Demo instrumentation: makes it visible that exactly this row re-rendered. */
    protected renders: number = 0;

    public handleChangeTitle = (event: React.ChangeEvent<HTMLInputElement>) => {
        const {carburetor, id} = this.props;
        const todo = carburetor.getData().items[id];

        carburetor.updateTodo({...todo, title: event.target.value});
    };

    public handleChangeDone = (event: React.ChangeEvent<HTMLInputElement>) => {
        const {carburetor, id} = this.props;
        const todo = carburetor.getData().items[id];

        carburetor.updateTodo({...todo, done: event.target.checked});
    };

    public handleClickDelete = () => {
        this.props.carburetor.deleteTodo(this.props.id);
    };

    public renderCheckIcon() {
        return (
            <svg
                className="pointer-events-none absolute left-1 size-3 text-white opacity-0 transition-opacity peer-checked:opacity-100 dark:text-slate-900"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M4 12.5l5.5 5.5L20 6"/>
            </svg>
        );
    }

    public renderTrashIcon() {
        return (
            <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M4 7h16M9 7V4.5h6V7M10 11.5v6M14 11.5v6M6.5 7l.9 12.2a1.3 1.3 0 001.3 1.3h6.6a1.3 1.3 0 001.3-1.3L17.5 7"/>
            </svg>
        );
    }

    public render() {
        const {id} = this.props;
        const {items} = this.useCarburetor(this.props.carburetor);

        if (!(id in items)) {
            return null;
        }

        const todo = items[id];
        this.renders++;

        const titleClass = 'w-full bg-transparent text-sm outline-none placeholder:text-slate-400 '
            + (todo.done
                ? 'text-slate-400 line-through dark:text-slate-500'
                : 'text-slate-800 dark:text-slate-100');

        return (
            <li
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                data-testid="todo-item"
            >
                <label className="relative flex cursor-pointer items-center">
                    <input
                        type="checkbox"
                        checked={todo.done}
                        onChange={this.handleChangeDone}
                        data-testid="todo-done"
                        className="peer size-5 shrink-0 cursor-pointer appearance-none rounded-md border border-slate-300 bg-white transition-colors checked:border-slate-900 checked:bg-slate-900 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:checked:border-slate-100 dark:checked:bg-slate-100"
                    />
                    {this.renderCheckIcon()}
                </label>

                <input
                    value={todo.title}
                    readOnly={todo.done}
                    onChange={this.handleChangeTitle}
                    placeholder="What needs to be done?"
                    data-testid="todo-title"
                    className={titleClass}
                />

                <span
                    className="font-mono text-[10px] tabular-nums text-slate-300 dark:text-slate-600"
                    title="How many times this row has re-rendered"
                    data-testid="todo-renders"
                >
                    {this.renders}
                </span>

                <button
                    type="button"
                    onClick={this.handleClickDelete}
                    aria-label="Delete todo"
                    data-testid="todo-delete"
                    className="rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 group-hover:opacity-100 max-sm:opacity-100 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                    {this.renderTrashIcon()}
                </button>
            </li>
        );
    }
}
