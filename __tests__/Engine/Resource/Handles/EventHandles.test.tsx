import * as React from 'react';
import {act} from 'react';
import {render, fireEvent} from '@testing-library/react';
import {ResourceCarburetor} from '@/Carburetor';
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
});
