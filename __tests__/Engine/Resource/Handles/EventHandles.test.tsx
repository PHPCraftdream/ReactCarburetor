import * as React from 'react';
import {act} from 'react';
import {render, fireEvent} from '@testing-library/react';
import {ResourceCarburetor} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {enableReactActEnvironment} from '../../../reactActEnvironment';

enableReactActEnvironment();

/** A zero-argument loader that records the arguments it was called with. */
const recorded = () => {
    const callArgs: unknown[][] = [];
    const load = async (...args: unknown[]): Promise<string> => {
        callArgs.push(args);
        return 'answer';
    };
    return {callArgs, load};
};

const isSignalOnly = (args: unknown[]): boolean =>
    args.length === 1 && args[0] instanceof AbortSignal;

describe('event arguments are dropped by the bound handles (D2)', () => {
    test('onClick={resource.load} hands the loader only a signal', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string>(loader.load);

        const {container} = render(<button onClick={resource.load}>go</button>);
        try {
            await act(async () => {
                fireEvent.click(container.querySelector('button')!);
            });

            expect(loader.callArgs).toHaveLength(1);
            expect(isSignalOnly(loader.callArgs[0])).toBe(true);
            expect(resource.getData().data).toBe('answer');
        } finally {
            container.remove();
        }
    });

    test('addEventListener passes a DOM event to the loader as a signal only', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string>(loader.load);

        const element = document.createElement('button');
        element.addEventListener('click', resource.load);
        document.body.appendChild(element);
        try {
            element.dispatchEvent(new Event('click'));
            await act(async () => {
                await Promise.resolve();
            });

            expect(loader.callArgs).toHaveLength(1);
            expect(isSignalOnly(loader.callArgs[0])).toBe(true);
        } finally {
            element.remove();
        }
    });

    test('a direct refresh() on a parameterless resource passes no arguments', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string>(loader.load);

        await resource.refresh();

        expect(loader.callArgs).toHaveLength(1);
        expect(isSignalOnly(loader.callArgs[0])).toBe(true);
    });

    test('handles work where no global Event exists', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string>(loader.load);
        const saved = Object.getOwnPropertyDescriptor(globalThis, 'Event')!;
        Reflect.deleteProperty(globalThis, 'Event');
        try {
            await resource.load();
            await resource.refresh();
        } finally {
            Object.defineProperty(globalThis, 'Event', saved);
        }
        expect(loader.callArgs).toHaveLength(2);
    });

    test('a React Native style synthetic event is dropped where no global Event exists', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string>(loader.load);
        const saved = Object.getOwnPropertyDescriptor(globalThis, 'Event')!;
        Reflect.deleteProperty(globalThis, 'Event');
        try {
            // React Native hands a plain-object synthetic event without any DOM Event around.
            const press = {
                nativeEvent: {pageX: 12},
                isDefaultPrevented: (): boolean => false,
            };
            await resource.load(press as unknown as never);
        } finally {
            Object.defineProperty(globalThis, 'Event', saved);
        }
        expect(loader.callArgs).toHaveLength(1);
        expect(loader.callArgs[0]).toHaveLength(1);
        expect(loader.callArgs[0]![0]).toBeInstanceOf(AbortSignal);
    });
});

describe('plain-JS subclass prototype overrides reach the handles', () => {
    test('a prototype load override is not shadowed by the bound handle', async () => {
        const calls: string[] = [];
        const overrideCalls: unknown[] = [];
        class Users extends ResourceCarburetor<string, [string]> {}
        (Users.prototype as unknown as {load: (...args: unknown[]) => Promise<void>}).load =
            function (this: ResourceCarburetor<string, [string]>, ...args: unknown[]): Promise<void> {
                overrideCalls.push(args[0]);
                return ResourceCarburetor.prototype.load.apply(this, args as [string]);
            };
        const users = new Users(async key => {
            calls.push(key);
            return `answer-${key}`;
        });

        expect(typeof users.load).toBe('function');
        await users.load('a');
        expect(overrideCalls).toEqual(['a']);
        expect(calls).toEqual(['a']);
    });

    test('a prototype refresh override is not shadowed by the bound handle', async () => {
        const calls: string[] = [];
        const overrideCalls: unknown[] = [];
        class Users extends ResourceCarburetor<string, [string]> {}
        (Users.prototype as unknown as {refresh: (...args: unknown[]) => Promise<void>}).refresh =
            function (this: ResourceCarburetor<string, [string]>, ...args: unknown[]): Promise<void> {
                overrideCalls.push(args[0]);
                return ResourceCarburetor.prototype.refresh.apply(this, args as [string]);
            };
        const users = new Users(async key => {
            calls.push(key);
            return `answer-${key}`;
        });

        expect(typeof users.refresh).toBe('function');
        await users.refresh('a');
        expect(overrideCalls).toEqual(['a']);
        expect(calls).toEqual(['a']);
    });

    test('a detached handle keeps its binding', async () => {
        const calls: string[] = [];
        const users = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        });
        const {load} = users;
        await load('b');
        expect(calls).toEqual(['b']);
        expect(users.getData().data).toBe('answer-b');
    });
});

describe('plain-JS cache subclass prototype overrides reach load and refresh', () => {
    test('a prototype load override is not shadowed by the bound handle', async () => {
        const calls: string[] = [];
        const overrideCalls: unknown[] = [];
        class Users extends ResourceCache<string, [string]> {}
        (Users.prototype as unknown as {load: (...args: unknown[]) => Promise<void>}).load =
            function (this: ResourceCache<string, [string]>, ...args: unknown[]): Promise<void> {
                overrideCalls.push(args[0]);
                return ResourceCache.prototype.load.apply(this, args as [string]);
            };
        const users = new Users(async key => {
            calls.push(key);
            return `answer-${key}`;
        });

        expect(typeof users.load).toBe('function');
        await users.load('a');
        expect(overrideCalls).toEqual(['a']);
        expect(calls).toEqual(['a']);
    });

    test('a prototype refresh override is not shadowed by the bound handle', async () => {
        const calls: string[] = [];
        const overrideCalls: unknown[] = [];
        class Users extends ResourceCache<string, [string]> {}
        (Users.prototype as unknown as {refresh: (...args: unknown[]) => Promise<void>}).refresh =
            function (this: ResourceCache<string, [string]>, ...args: unknown[]): Promise<void> {
                overrideCalls.push(args[0]);
                return ResourceCache.prototype.refresh.apply(this, args as [string]);
            };
        const users = new Users(async key => {
            calls.push(key);
            return `answer-${key}`;
        });

        expect(typeof users.refresh).toBe('function');
        await users.refresh('a');
        expect(overrideCalls).toEqual(['a']);
        expect(calls).toEqual(['a']);
    });
});
