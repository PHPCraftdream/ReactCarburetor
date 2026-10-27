import {
    ComponentUpdateThrottle, ICarburetor, ICarburetorSubscription, IInspectable, IReadableCarburetor,
    ISubscribeOptions, IUpdateScheduler, TSelector,
} from '@react-carburetor/core';

interface Model {value: number}
declare const store: ICarburetor<Model>;
const readable: IReadableCarburetor<Model> = store;
const subscription: ICarburetorSubscription = store;
const inspectable: IInspectable = store;
const options: ISubscribeOptions = {reads: new Set(['value'])};
const scheduler: IUpdateScheduler = {schedule: (_uid, update) => update(), cancel: () => undefined};
const throttle = new ComponentUpdateThrottle();
const selectValue: TSelector<Model, number> = data => data.value;
void [readable, subscription, inspectable, options, scheduler, selectValue, throttle];
