import {AntiHookComponent} from 'react-carburetor';

declare function subscribeToSocket(): () => void;
declare function startTimer(): () => void;

export class WrongEffects extends AntiHookComponent {
    protected useEffects(): void {
        const url = '';
        const interval = 0;

        // #region doc
        this.useEffect('effect', subscribeToSocket, [url]);
        this.useEffect('effect', startTimer, [interval]);
        // #endregion doc
    }

    public render() {
        return null;
    }
}
