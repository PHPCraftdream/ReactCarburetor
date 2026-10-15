import {AntiHookComponent} from 'react-carburetor';

export class WrongMount extends AntiHookComponent {
    private load(): void {
        void this.props;
    }

    // #region doc
    public componentDidMount(): void {
        this.load();
    }
    // #endregion doc

    public render() {
        return null;
    }
}
