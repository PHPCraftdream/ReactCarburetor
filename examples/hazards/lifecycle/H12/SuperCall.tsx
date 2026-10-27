import {AntiHookComponent} from '@react-carburetor/core';

export class GoodMount extends AntiHookComponent {
    private load(): void {
        void this.props;
    }

    // #region doc
    public componentDidMount(): void {
        super.componentDidMount();

        this.load();
    }
    // #endregion doc

    public render() {
        return null;
    }
}
