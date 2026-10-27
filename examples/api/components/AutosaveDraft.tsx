// #region component
import {
    AntiHookComponent,
    Carburetor,
    TEffect,
    TEffectCleanup,
    TEffectDeps,
    TTimerHandle,
} from '@react-carburetor/core';

interface IDraftData {
    text: string;
}

interface IAutosaveProps {
    draft: Carburetor<IDraftData>;
    save: (text: string) => void;
}

const makeCleanup = (handle: TTimerHandle): TEffectCleanup => (): void => clearTimeout(handle);

const makeAutosave = (props: IAutosaveProps): TEffect => (): TEffectCleanup => {
    const handle = setTimeout(() => props.save(props.draft.getData().text), 500);
    return makeCleanup(handle);
};

export class AutosaveDraft extends AntiHookComponent<IAutosaveProps> {
    private readonly autosave = makeAutosave(this.props);

    public render() {
        const view = this.useCarburetor(this.props.draft);
        return <textarea value={view.text} readOnly/>;
    }

    protected useEffects(): void {
        const deps: TEffectDeps = [this.props.draft.getData().text];
        this.useEffect('autosave', this.autosave, deps);
    }
}
// #endregion component
