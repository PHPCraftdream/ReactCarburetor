import {AntiHookComponent, Carburetor, TStoreEffect} from '@react-carburetor/core';

interface IChannel {close(): void}
interface ITodoApi {loadData(): Promise<void>}
interface ITodoProps {carburetor: ITodoApi; channel: IChannel}

const connect = (channel: IChannel): IChannel => channel;

// #region useEffects
export class TodoApp extends AntiHookComponent<ITodoProps> {
    protected useEffects(): void {
        this.useEffect('loadData', () => { void this.props.carburetor.loadData(); }, [this.props.carburetor]);

        this.useEffect(
            'channel',
            () => {
                const socket = connect(this.props.channel);
                return () => socket.close();
            },
            [this.props.channel]
        );
    }
}
// #endregion useEffects

interface ISettingsData {theme: string; lang: string}
interface IShellProps {settings: Carburetor<ISettingsData>}

const selectTheme = (data: ISettingsData): string => data.theme;

const applyTheme: TStoreEffect<string> = (theme) => {
    document.documentElement.dataset.theme = theme;
};

// #region storeEffect
export class Shell extends AntiHookComponent<IShellProps> {
    protected useEffects(): void {
        // Runs after mount with the current theme and again on every change; render never reads it.
        this.useStoreEffect('theme', this.props.settings, selectTheme, applyTheme);
    }

    public render() {
        return null;
    }
}
// #endregion storeEffect
