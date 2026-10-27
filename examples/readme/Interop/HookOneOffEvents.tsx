import {Carburetor} from '@react-carburetor/core';
import {useCarburetorEvent} from '@react-carburetor/core/interop';

interface IEvents {connected: {at: number}}

class StatusCarburetor extends Carburetor<{online: boolean}, IEvents> {}
const statusCarburetor = new StatusCarburetor({online: false});
/** @param event - the connection event payload */
const receiveConnected = (event: IEvents['connected']): void => {
    console.info('Connected at', event.at);
};

export const HookStatus = () => {
    useCarburetorEvent(statusCarburetor, 'connected', receiveConnected);
    return null;
};
