import {
    Carburetor, EDevToolsAction, EDevToolsMessageType, IDevToolsConnection, IDevToolsMessage, connectDevTools,
} from '@/Carburetor';

describe('connectDevTools', () => {
    test('ignores malformed dispatches, applies own jump entries, and disposes both subscriptions', () => {
        const store = new Carburetor({value: 1});
        let listener: ((message: IDevToolsMessage) => void) | undefined;
        let unsubscribed = false;
        const connection: IDevToolsConnection = {
            init: () => {}, send: () => {},
            subscribe: callback => { listener = callback; return () => { unsubscribed = true; }; }
        };
        let storeUnsubscribed = false;
        const originalUnsubscribe = store.unsubscribe.bind(store);
        store.unsubscribe = id => { storeUnsubscribed = true; originalUnsubscribe(id); };
        const dispose = connectDevTools({value: store}, {extension: {connect: () => connection}});
        listener?.({type: EDevToolsMessageType.Dispatch, payload: undefined, state: '{'});
        listener?.({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.JumpToState},
            state: JSON.stringify({value: {value: 7}}),
        });
        expect(store.getData().value).toBe(7);
        listener?.({type: EDevToolsMessageType.Dispatch, payload: {type: 'OTHER'}, state: '{'});
        dispose();
        expect(storeUnsubscribed).toBe(true);
        expect(unsubscribed).toBe(true);
    });
    test('ignores empty state and unsupported dispatch actions without changing stores', () => {
        const store = new Carburetor({value: 1});
        let listener: ((message: IDevToolsMessage) => void) | undefined;
        const connection: IDevToolsConnection = {
            init: () => {}, send: () => {},
            subscribe: callback => { listener = callback; return () => {}; },
        };
        const dispose = connectDevTools({value: store}, {extension: {connect: () => connection}});
        listener?.({type: EDevToolsMessageType.Dispatch, payload: {type: EDevToolsAction.JumpToState}, state: ''});
        listener?.({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: 'OTHER'},
            state: JSON.stringify({value: {value: 9}}),
        });
        expect(store.getData().value).toBe(1);
        dispose();
    });
});
