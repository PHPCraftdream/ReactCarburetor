import * as React from "react";
import {createRoot} from "react-dom/client";
import './styles.css';
import {TodoApp} from "./ToDo/TodoApp";
import {todoCarburetor} from "./ToDo/Carburetors/TodoCarburetorInstance";

class App extends React.Component {
    public render() {
        return (
            <div className="min-h-full bg-linear-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-10 sm:py-16 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
                <div className="mx-auto w-full max-w-xl">
                    <TodoApp carburetor={todoCarburetor}/>
                </div>
            </div>
        );
    }
}

const rootElement = document.getElementById("root") as HTMLElement;
createRoot(rootElement).render(<App/>);
