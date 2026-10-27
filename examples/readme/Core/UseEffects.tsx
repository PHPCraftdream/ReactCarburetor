import {AntiHookComponent} from '@react-carburetor/core';

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
