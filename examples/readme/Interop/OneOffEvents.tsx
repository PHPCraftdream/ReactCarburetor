import {bind} from 'react-carburetor';
import {AntiHookComponent, Carburetor} from 'react-carburetor';
import type {ICarburetorEvents} from 'react-carburetor';

interface IStatus {online: boolean}
interface IEvents {connected: {at: number}}

/** Sets the status online before its connected event is emitted. */
const setOnline = (draft: IStatus): void => {
    draft.online = true;
};

class StatusCarburetor extends Carburetor<IStatus, IEvents> {
    @bind
    connect(): void {
        this.update(setOnline);
        this.emit('connected', {at: Date.now()});
    }
}

const statusCarburetor = new StatusCarburetor({online: false});

/** Logs one connection event. */
const logConnected = (event: IEvents['connected']): void => {
    console.info('Connected at', event.at);
};

/** Any store emitting `connected` fits, not only StatusCarburetor. */
export const watchConnections = (source: ICarburetorEvents<IEvents>): (() => void) =>
    source.on('connected', logConnected);

export class StatusView extends AntiHookComponent {
    protected useEffects(): void {
        this.useEvent(statusCarburetor, 'connected', this.receiveConnected);
    }

    /** @param event - the connection event payload */
    @bind
    protected receiveConnected(event: IEvents['connected']): void {
        console.info('Connected at', event.at);
    }

    public render() {
        const {online} = this.useCarburetor(statusCarburetor);
        return <button onClick={statusCarburetor.connect}>{online ? 'Online' : 'Connect'}</button>;
    }
}
