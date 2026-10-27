import {AntiHookComponent, bind} from '@react-carburetor/core';

export class WrongField extends AntiHookComponent {
    // #region doc
    public componentDidMount = () => {
        super.componentDidMount();       // reachable, but the base method is shadowed anyway

        this.load();
    };
    // #endregion doc

    @bind
    private load(): void {
        void this.props;
    }

    public render() {
        return null;
    }
}
