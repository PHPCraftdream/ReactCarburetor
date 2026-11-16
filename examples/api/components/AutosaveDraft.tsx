// #region component
import {
    AntiHookComponent,
    bind,
    Carburetor,
    TEffectCleanup,
    TTimerHandle,
} from '@react-carburetor/core';

interface IDraftData {
    text: string;
}

interface IAutosaveProps {
    draft: Carburetor<IDraftData>;
    save: (text: string) => void;
}

const selectText = (data: IDraftData): string => data.text;

const makeCleanup = (handle: TTimerHandle): TEffectCleanup => (): void => clearTimeout(handle);

export class AutosaveDraft extends AntiHookComponent<IAutosaveProps> {
    public render() {
        const view = this.useCarburetor(this.props.draft);
        return <textarea value={view.text} readOnly/>;
    }

    protected useEffects(): void {
        // Follows the text itself: each change cancels the pending save through the run's cleanup,
        // so the draft is saved 500 ms after it settles, and nothing is saved after unmount.
        this.useStoreEffect('autosave', this.props.draft, selectText, this.scheduleSave);
    }

    @bind
    private scheduleSave(text: string): TEffectCleanup {
        const handle = setTimeout(this.props.save, 500, text);
        return makeCleanup(handle);
    }
}
// #endregion component
