// #region subscribe-api
import {Carburetor, ICarburetorSubscription, ISubscribeOptions, TSubscriber} from '@react-carburetor/core';

const store = new Carburetor({value: 0});
const logging: ICarburetorSubscription = store; // the subscription surface every store has

const onWrite: TSubscriber = () => console.log('value is now', store.getData().value);

// Options are optional; here a stable id (re-subscribing with it replaces this
// registration) and the default read set — every write.
const options: ISubscribeOptions = {id: 'logger'};
const id: string = store.subscribe(onWrite, options);

store.setData({value: 1}); // logs 'value is now 1'
store.unsubscribe(id);     // also cancels an update already scheduled for it
store.setData({value: 2}); // nothing logged
console.log(logging.getUID() === store.getUID()); // true
// #endregion subscribe-api
