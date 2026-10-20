import {Carburetor} from '@/Carburetor';
import {useCarburetorEvent} from '@/Interop';
import type {ICarburetor, ICarburetorEvents, IReadableCarburetor} from '@/Carburetor/Models/Store';

interface IData {value: number}
interface IEvents {changed: {value: number}}

class EventStore extends Carburetor<IData, IEvents> {
    verifyEmitTypes(): void {
        this.emit('changed', {value: 1});
        // @ts-expect-error wrong payload type is rejected
        this.emit('changed', {value: 'wrong'});
        // @ts-expect-error unknown event names are rejected
        this.emit('missing', {value: 1});
    }
}
const store = new EventStore({value: 0});
const structuralAdapter: {on: <K extends keyof IEvents>(
    name: K, listener: (payload: IEvents[K]) => void
) => () => void} = {
    on: (_name, _listener) => () => {},
};
const oldReadableAdapter: IReadableCarburetor<IData> = {
    getUID: () => 'legacy',
    getVersion: () => 0,
    subscribe: () => 'id',
    unsubscribe: () => {},
    getData: () => ({value: 0}),
    read: () => ({value: 0}),
};

function verifyEventInference(): void {
    useCarburetorEvent(store, 'changed', payload => {
        const value: number = payload.value;
        void value;
    });
    // @ts-expect-error unknown event names are rejected
    useCarburetorEvent(store, 'missing', payload => { void payload; });
    useCarburetorEvent(store, 'changed', payload => {
        // @ts-expect-error payload exposes only the declared number value
        const text: string = payload.value;
        void text;
    });

    const eventAdapter: ICarburetorEvents<IEvents> = structuralAdapter;
    useCarburetorEvent(eventAdapter, 'changed', payload => {
        const value: number = payload.value;
        void value;
    });
    const readable: IReadableCarburetor<IData> = store;
    const carburetor: ICarburetor<IData> = store;
    const eventReadable: IReadableCarburetor<IData> = oldReadableAdapter;
    const newInferred: IReadableCarburetor<IData> = new Carburetor({value: 0});
    void readable;
    void carburetor;
    void eventReadable;
    void newInferred;
    // @ts-expect-error on() rejects unknown event names
    store.on('missing', () => {});
    // @ts-expect-error on() rejects a payload callback of the wrong type
    store.on('changed', (payload: string) => { void payload; });
}
void verifyEventInference;
