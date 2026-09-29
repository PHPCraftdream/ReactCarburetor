import { IDict, TSubscriber } from '../Models/Base.js';
import { ICarburetorSubscription, ISubscribeOptions } from '../Models/Store.js';
interface IVersion {
    source: ICarburetorSubscription;
    version: number;
}
export declare const computedDependencies: {
    versions: WeakMap<ICarburetorSubscription, () => IDict<IVersion>>;
    subscribe(source: ICarburetorSubscription, callback: TSubscriber, options: ISubscribeOptions): void;
    unsubscribe(source: ICarburetorSubscription, id: string): void;
};
export {};
