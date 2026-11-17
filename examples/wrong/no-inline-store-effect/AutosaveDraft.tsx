import {AntiHookComponent, Carburetor, TEffectCleanup, TTimerHandle} from '@react-carburetor/core';

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
        // A new bound function on every render: the watch restarts and the save runs again each time.
        this.useStoreEffect('autosave', this.props.draft, selectText, this.scheduleSave.bind(this));
    }

    private scheduleSave(text: string): TEffectCleanup {
        const handle = setTimeout(this.props.save, 500, text);
        return makeCleanup(handle);
    }
}
