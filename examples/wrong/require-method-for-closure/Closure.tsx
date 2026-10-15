import {AntiHookComponent, Carburetor} from 'react-carburetor';

class Todos extends Carburetor<{ids: string[]}> {}

class TodoItem extends AntiHookComponent<{carburetor: Todos; id: string}> {
    public render() {
        return null;
    }
}

export class WrongClosure extends AntiHookComponent<{orderIds: string[]; carburetor: Todos}> {
    public render() {
        // #region doc
        const {orderIds, carburetor} = this.props;

        return <ul>{orderIds.map((id: string) =>
            <TodoItem key={id} carburetor={carburetor} id={id}/>)}
        </ul>;
        // #endregion doc
    }
}
