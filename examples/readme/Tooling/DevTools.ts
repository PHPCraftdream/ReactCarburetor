import {Carburetor, CarburetorHistory, connectDevTools, persist, waitForUpdate} from 'react-carburetor';
import {presenceCarburetor} from '../Core/Throttle';

const log = (next: number, previous: number): void => {console.log(next, previous);};

interface ITodoState {activeCount: number}

class TodoStore extends Carburetor<ITodoState> {}
class FilterStore extends Carburetor<{query: string}> {}
class SettingsStore extends Carburetor<{theme: string}> {}

const todoCarburetor = new TodoStore({activeCount: 0});
const filterCarburetor = new FilterStore({query: ''});
const settingsCarburetor = new SettingsStore({theme: 'light'});

// #region tooling
// Redux DevTools: state inspection plus time travel back onto the carburetors.
const stopDevTools = connectDevTools({todos: todoCarburetor, filter: filterCarburetor});

// Mirror a store in a storage; loads what was stored on connect. Writes are coalesced into one
// stringify per microtask; `coalesce: false` writes on every notification instead, so with the
// default immediate delivery each write lands before the writing call returns (a throttle or a
// transaction delays the notification, and the write with it).
const stopPersist = persist(settingsCarburetor, {key: 'settings', storage: localStorage});

// React to a selection outside React; onChange runs only when it changes.
const stop = todoCarburetor.watch((data) => data.activeCount, (next, previous) => log(next, previous));

// Undo/redo built on patches.
const history = new CarburetorHistory(todoCarburetor, {limit: 50});
history.undo();
history.redo();

// Await the next update — for throttled stores and async resources in tests.
await waitForUpdate(presenceCarburetor);

// Stop subscriptions and tooling when their owner is done.
stop();
stopPersist();
stopDevTools();
history.disconnect();
// #endregion tooling
