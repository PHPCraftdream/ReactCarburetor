// #region doc
import {
    bind,
    Carburetor,
    connectDevTools,
    EDevToolsAction,
    EDevToolsMessageType,
    IDevToolsConnection,
    IDevToolsExtension,
    IDevToolsMessage,
    IDevToolsOptions,
    TDisposer,
} from '@react-carburetor/core';

const incrementCount = (draft: {count: number}): void => { draft.count += 1; };
const sendDevTools = (action: string, state: unknown): void => { console.log(action, state); };

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind
    public increment(): void { this.update(incrementCount); }
}

const store = new CounterCarburetor({count: 0});
store.increment();

class StubDevToolsExtension implements IDevToolsExtension {
    private listener: ((message: IDevToolsMessage) => void) | undefined;

    public connect(options: {name?: string}): IDevToolsConnection {
        return {
            init: (state: unknown): void => { console.log(options.name ?? '', state); },
            send: sendDevTools,
            subscribe: (listener: (message: IDevToolsMessage) => void): TDisposer => {
                this.listener = listener;
                return () => { this.listener = undefined; };
            },
        };
    }

    @bind
    public jumpTo(state: {counter: {count: number}}): void {
        this.listener?.({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.JumpToAction},
            state: JSON.stringify(state),
        });
    }
}

const extension = new StubDevToolsExtension();
const devToolsOptions: IDevToolsOptions = {name: 'Counter demo', extension};
const stopDevTools = connectDevTools({counter: store}, devToolsOptions);

extension.jumpTo({counter: {count: 0}});
console.log(store.getData().count); // 0 — time travel reverted the store
stopDevTools();
// #endregion doc
