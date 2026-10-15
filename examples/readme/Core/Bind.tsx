import {AntiHookComponent, Carburetor, bind} from 'react-carburetor';

interface IState {items: Record<string, {done: boolean}>}

class TodoStore extends Carburetor<IState> {
    public toggle(_id: string): void {}
}

const todoCarburetor = new TodoStore({items: {}});

interface IProps {id: string}

// #region bind
class TodoRow extends AntiHookComponent<IProps> {
    @bind
    protected onToggle(): void {
        todoCarburetor.toggle(this.props.id);
    }

    public render() {
        return <button onClick={this.onToggle}>toggle</button>;
    }
}
// #endregion bind

void TodoRow;
