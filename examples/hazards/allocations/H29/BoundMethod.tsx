import {AntiHookComponent, Carburetor, bind} from 'react-carburetor';

class Todos extends Carburetor<{ids: string[]}> {}

class TodoItem extends AntiHookComponent<{carburetor: Todos; id: string}> {
    public render() {
        return null;
    }
}

export class GoodList extends AntiHookComponent<{orderIds: string[]; carburetor: Todos}> {
    // #region doc
    @bind
    private renderTodoItem(id: string) {
        return <TodoItem key={id} carburetor={this.props.carburetor} id={id}/>;
    }

    public render() {
        return <ul>{this.props.orderIds.map(this.renderTodoItem)}</ul>;
    }
    // #endregion doc
}
