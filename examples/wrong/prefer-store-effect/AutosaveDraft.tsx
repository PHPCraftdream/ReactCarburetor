import {AntiHookComponent, bind, Carburetor, TDisposer} from '@react-carburetor/core';

interface IDraftData {
    text: string;
}

interface IAutosaveProps {
    draft: Carburetor<IDraftData>;
    save: (text: string) => void;
}

const selectText = (data: IDraftData): string => data.text;

export class AutosaveDraft extends AntiHookComponent<IAutosaveProps> {
    private stopWatching: TDisposer | undefined;

    public render() {
        const view = this.useCarburetor(this.props.draft);
        return <textarea value={view.text} readOnly/>;
    }

    public componentDidMount(): void {
        super.componentDidMount();
        // By hand: no save for the text at mount, and a changed draft prop keeps the old watch.
        this.stopWatching = this.props.draft.watch(selectText, this.saveText);
    }

    public componentWillUnmount(): void {
        this.stopWatching?.();
        super.componentWillUnmount();
    }

    protected useEffects(): void {
        // Nothing to follow here: the watch above does it.
    }

    @bind
    private saveText(text: string): void {
        this.props.save(text);
    }
}
