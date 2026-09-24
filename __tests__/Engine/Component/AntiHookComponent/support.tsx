import * as React from 'react';
import {act} from 'react';
import {rstest} from '@rstest/core';
import {fireEvent, render} from '@testing-library/react';
import {
    AntiHookComponent,
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    ComponentUpdateThrottle,
    EResourceStatus,
    IDict,
    ScopedAntiHookComponent,
    carburetorToken,
    computed
} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {TPath, TPathSet} from '@/Carburetor/Models/Paths';
import {TReadonly, TSubscriber} from '@/Carburetor/Models/Base';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';

export {
    React,
    act,
    rstest,
    fireEvent,
    render,
    AntiHookComponent,
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    ComponentUpdateThrottle,
    EResourceStatus,
    IDict,
    ScopedAntiHookComponent,
    carburetorToken,
    computed,
    ResourceCache,
    TPath,
    TPathSet,
    TReadonly,
    TSubscriber,
    ISubscribeOptions
};

export const REACT_MAJOR = Number.parseInt(React.version, 10);

export interface ICounterData {
    value: number;
    other: number;
}

export const getCounterData = (): ICounterData => ({value: 0, other: 0});

export class CounterCarburetor extends Carburetor<ICounterData> {
    public subscriberCount = (): number => Object.keys(this.subscribers).length;

    public incValue = (): void => {
        this.draft.value++;
        this.emitUpdate();
    };

    public incOther = (): void => {
        this.draft.other++;
        this.emitUpdate();
    };
}

export class ObservedCarburetor extends CounterCarburetor {
    public subscribeReads: TPathSet[] = [];

    private readonly baseSubscribe = this.subscribe;

    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        this.subscribeReads.push(new Set<TPath>(options.reads ?? []));
        return this.baseSubscribe(callback, options);
    };
}

export const SYM = Symbol('r2-07');

export interface ITodoPayload {
    [key: string]: unknown;
    [SYM]?: number;
}

export interface ITodoData {
    payload: ITodoPayload;
}

export class TodoCarburetor extends Carburetor<ITodoData> {
    public replacePayload = (payload: ITodoPayload): void => {
        this.update((draft: ITodoData): void => {
            draft.payload = payload;
        });
    };
}

export interface IProps {
    a: number;
    b: number;
}

export const renderArrayItem = (item: {id: number}): React.ReactNode =>
    <li key={item.id} className="item">{item.id}</li>;

export interface ITodoLike {
    items: {
        [id: string]: {
            title: string;
            done: boolean;
        };
    };
}

export const getTodoData = (): ITodoLike => ({
    items: {
        a: {title: 'a', done: false},
        b: {title: 'b', done: true},
    },
});

export class ListCarburetor extends Carburetor<ITodoLike> {
    public setDone = (id: string, done: boolean): void => {
        this.draft.items[id].done = done;
        this.emitUpdate();
    };
}

export const makeLoader = () => {
    const calls: string[] = [];
    const settle: ((value: string) => void)[] = [];
    const load = (id: string): Promise<string> => {
        calls.push(id);
        return new Promise<string>((resolve) => settle.push(resolve));
    };

    return {calls, settle, load};
};

export const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};
