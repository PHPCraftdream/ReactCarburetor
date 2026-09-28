import {rstest} from '@rstest/core';
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";

// Mirrors the key format sharedSingleton.ts builds internally, so a test can seed or clear
// a slot without the module exposing that as part of its actual API.
const keyFor = (name: string): symbol => Symbol.for(`react-carburetor/v1/${name}`);

const clear = (name: string): void => {
    delete (globalThis as Record<symbol, unknown>)[keyFor(name)];
};

describe('sharedSingleton', () => {
    test('creates once and reuses the same value on later calls', () => {
        const name = 'unit/creates-once';

        try {
            let calls = 0;
            const create = () => {
                calls += 1;

                return {tag: 'value'};
            };

            const first = sharedSingleton(name, create);
            const second = sharedSingleton(name, create);

            expect(second).toBe(first);
            expect(calls).toEqual(1);
        } finally {
            clear(name);
        }
    });

    test('independent names get independent values', () => {
        const a = 'unit/independent-a';
        const b = 'unit/independent-b';

        try {
            const valueA = sharedSingleton(a, () => ({tag: 'a'}));
            const valueB = sharedSingleton(b, () => ({tag: 'b'}));

            expect(valueA).not.toBe(valueB);
        } finally {
            clear(a);
            clear(b);
        }
    });

    test('reports once, in development, when an existing entry came from a different copy', () => {
        const name = 'unit/foreign-copy';
        const seeded = {tag: 'seeded'};

        (globalThis as Record<symbol, unknown>)[keyFor(name)] =
            {value: seeded, copy: {}, react: undefined, reported: false};

        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const first = sharedSingleton(name, () => ({tag: 'never'}));
            const second = sharedSingleton(name, () => ({tag: 'never'}));

            expect(first).toBe(seeded);
            expect(second).toBe(seeded);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('duplicated');
        } finally {
            errorSpy.mockRestore();
            clear(name);
        }
    });

    test('reports once when a later call passes a React module the entry did not record', () => {
        const name = 'unit/foreign-react';
        const reactA = {tag: 'react-a'};
        const reactB = {tag: 'react-b'};

        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const created = sharedSingleton(name, () => ({tag: 'value'}), reactA);

            let secondFactoryRan = false;
            const second = sharedSingleton(name, () => {
                secondFactoryRan = true;

                return {tag: 'other'};
            }, reactB);
            const third = sharedSingleton(name, () => ({tag: 'third'}), reactB);

            expect(second).toBe(created);
            expect(secondFactoryRan).toBeFalsy();
            expect(third).toBe(created);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('React modules');
        } finally {
            errorSpy.mockRestore();
            clear(name);
        }
    });

    test('a foreign copy with the same underlying React reports only the copy warning', () => {
        // require('react') and import * as React from 'react' wrap the same install in two
        // different objects; a caller compares a stable identity (e.g. React.Component)
        // instead, so this shape must not read as a different React.
        const name = 'unit/foreign-copy-same-react';
        const component = function Component() {};
        const cjsExports = {Component: component};
        const esmNamespace = {Component: component};

        (globalThis as Record<symbol, unknown>)[keyFor(name)] =
            {value: {tag: 'seeded'}, copy: {}, react: cjsExports.Component, reported: false};

        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            sharedSingleton(name, () => ({tag: 'never'}), esmNamespace.Component);

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('duplicated');
            expect(String(errorSpy.mock.calls[0][0])).not.toContain('React modules');
        } finally {
            errorSpy.mockRestore();
            clear(name);
        }
    });

    test('a foreign copy with a genuinely different React reports the React clause too', () => {
        const name = 'unit/foreign-copy-different-react';
        const componentA = function ComponentA() {};
        const componentB = function ComponentB() {};

        (globalThis as Record<symbol, unknown>)[keyFor(name)] =
            {value: {tag: 'seeded'}, copy: {}, react: componentA, reported: false};

        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            sharedSingleton(name, () => ({tag: 'never'}), componentB);

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('duplicated');
            expect(String(errorSpy.mock.calls[0][0])).toContain('React modules');
        } finally {
            errorSpy.mockRestore();
            clear(name);
        }
    });

    test('stays silent when the same copy reuses the same React module', () => {
        const name = 'unit/same-react';
        const react = {tag: 'react'};

        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            sharedSingleton(name, () => ({tag: 'value'}), react);
            sharedSingleton(name, () => ({tag: 'value-again'}), react);

            expect(errorSpy).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
            clear(name);
        }
    });
});
