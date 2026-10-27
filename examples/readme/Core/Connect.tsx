import type {JSX} from 'react';
import {AntiHookComponent, Carburetor} from '@react-carburetor/core';

interface ITodoItem {title: string; done: boolean}
interface ITodoList {orderIds: string[]; activeCount: number; items: Record<string, ITodoItem>}
interface ITodoProps {carburetor: Carburetor<ITodoList>; id: string}

class TodoItem extends AntiHookComponent<{id: string}> {
    public render(): null {
        return null;
    }
}

class MemoRow extends AntiHookComponent<{todo: {title: string; done: boolean}}> {
    public render(): null {
        return null;
    }
}

// #region connect
const renderTodoItem = (id: string): JSX.Element => <TodoItem key={id} id={id} />;

class TodoApp extends AntiHookComponent<ITodoProps> {
    private readonly todos = this.connect(() => this.props.carburetor);

    render() {
        return (
            <>
                <span>Active: {this.todos.activeCount}</span>
                {this.todos.orderIds.map(renderTodoItem)}
            </>
        );
    }
}
// #endregion connect

// #region connectSelection
class TodoList extends AntiHookComponent<ITodoProps> {
    private readonly row = this.connectSelection(
        () => this.props.carburetor,
        (data) => ({title: data.items[this.props.id].title, done: data.items[this.props.id].done})
    );

    render() {
        return <MemoRow todo={this.row()} />;
    }
}
// #endregion connectSelection

void TodoApp;
void TodoList;
