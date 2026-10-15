import {AntiHookComponent, bind} from 'react-carburetor';

class TodoRow extends AntiHookComponent<{onToggle(): void}> {
    public render() {
        return <button onClick={this.props.onToggle}>toggle</button>;
    }
}

export class WrongRows extends AntiHookComponent {
    @bind
    protected toggle(id: string): void {
        void this.props;
        void id;
    }

    public render() {
        const id = 'a';
        const rows = (
            // #region doc
            <>
                <TodoRow onToggle={() => this.toggle(id)}/>
                <TodoRow onToggle={this.toggle.bind(this)}/>
            </>
            // #endregion doc
        );

        return rows;
    }
}
