import {
    Carburetor, CarburetorHistory, IDevToolsConnection, IDevToolsExtension, IDevToolsMessage, IDevToolsOptions,
    IDict, IHistoryOptions, IPersistOptions, IStorageLike, TDisposer, connectDevTools, persist, waitForUpdate,
} from 'react-carburetor';

interface State {count: number}
const store = new Carburetor<State>({count: 0});
const storage: IStorageLike = {getItem: () => null, setItem: () => undefined, removeItem: () => undefined};
const persistenceOptions: IPersistOptions<State> = {key: 'counter', storage};
const historyOptions: IHistoryOptions = {limit: 20};
const message: IDevToolsMessage = {type: 'DISPATCH'};
const connection: IDevToolsConnection = {init: () => undefined, send: () => undefined, subscribe: () => undefined};
const extension: IDevToolsExtension = {connect: () => connection};
const devtools: IDevToolsOptions = {name: 'Counter', extension};
const stores: IDict<Carburetor<State>> = {counter: store};
const dispose: TDisposer = persist(store, persistenceOptions);
const history = new CarburetorHistory(store, historyOptions);
const stopHistory: TDisposer = () => history.disconnect();
const stopDevtools = connectDevTools(stores, devtools);
void waitForUpdate(store);
void [message, dispose, stopHistory, stopDevtools];
