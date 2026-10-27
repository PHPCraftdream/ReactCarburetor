import {AntiHookComponent, bind} from '@react-carburetor/core';

class TodoRow extends AntiHookComponent<{onToggle(): void}> {
    public render() {
        return <button onClick={this.props.onToggle}>toggle</button>;
    }
}

// #region doc
class Parent extends AntiHookComponent {
    @bind
    protected onToggle(): void { /* ... */ }

    public render() {
        return <TodoRow onToggle={this.onToggle}/>;
    }
}
// #endregion doc

void Parent;
