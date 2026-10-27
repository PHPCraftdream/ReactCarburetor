import {AntiHookComponent, Carburetor} from '@react-carburetor/core';

class Todos extends Carburetor<{items: string[]}> {}

class MemoRow extends AntiHookComponent<{todos: readonly string[]}> {
    public render() {
        return <span>{this.props.todos.length}</span>;
    }
}

export class WrongMemoRow extends AntiHookComponent<{carburetor: Todos}> {
    // #region doc
    private readonly todos = this.connect(() => this.props.carburetor);

    public render() {
        return <MemoRow todos={this.todos.items} />;   // a branch of the live view
    }
    // #endregion doc
}
