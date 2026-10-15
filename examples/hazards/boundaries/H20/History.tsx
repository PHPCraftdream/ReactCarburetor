import {AntiHookComponent, Carburetor, CarburetorHistory} from 'react-carburetor';

const todoCarburetor = new Carburetor({items: []});

export class HistoryOwner extends AntiHookComponent {
    private readonly history = new CarburetorHistory(todoCarburetor);

    protected unUseEffects(): void {
        // #region doc
        this.history.disconnect();
        // #endregion doc
    }

    public render() {
        return null;
    }
}
