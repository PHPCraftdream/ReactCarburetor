import * as React from "react";
import {createRoot} from "react-dom/client";
import './styles.css';
import {CarburetorProvider, connectDevTools, diagnostics} from "@/Carburetor";
import {TodoApp} from "./ToDo/TodoApp";
import {MockToDoClientAPI} from "./ToDo/API/MockToDoClientAPI";
import {createTodoScope} from "./ToDo/Scope/createTodoScope";
import {statusToken} from "./ToDo/Scope/Tokens/statusToken";
import {todoToken} from "./ToDo/Scope/Tokens/todoToken";

// A slow fake server, so the loading, cancel and refresh states are visible.
const {scope} = createTodoScope(new MockToDoClientAPI(400), window.localStorage);
const todos = scope.get(todoToken);

// watch() narrowed to one path: the tab title follows the open count and nothing else.
todos.watch(new Set(['activeCount']), () => {
    document.title = (todos.getData().activeCount ?? 0) + ' open — Todo demo';
});

// Misuse warnings are development-only anyway; the switch is shown here explicitly.
diagnostics.setEnabled(process.env.NODE_ENV !== 'production');

if (process.env.NODE_ENV !== 'production') {
    // A no-op without the Redux DevTools extension.
    connectDevTools({todos, status: scope.get(statusToken)}, {name: 'Todo demo'});
}

class App extends React.Component {
    /** The demo's shell: page chrome around the todo list. */
    public render() {
        return (
            <div className="min-h-full bg-linear-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-10 sm:py-16 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
                <div className="mx-auto w-full max-w-xl">
                    <TodoApp/>
                </div>
            </div>
        );
    }
}

const rootElement = document.getElementById("root") as HTMLElement;
createRoot(rootElement).render(
    <CarburetorProvider scope={scope}>
        <App/>
    </CarburetorProvider>
);
