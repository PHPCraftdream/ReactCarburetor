import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    carburetorToken,
    EResourceStatus,
    ICarburetorToken,
    ResourceCarburetor,
    ScopedAntiHookComponent
} from "@/Carburetor";

interface ICounterData {
    value: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public inc = () => {
        this.draft.value++;

        this.emitUpdate();
    };
}

const counterToken = carburetorToken<CounterCarburetor>(() => new CounterCarburetor({value: 0}), 'scope-test/counter');

class ScopedCounter extends ScopedAntiHookComponent {
    render() {
        const carburetor = this.resolve(counterToken);
        const {value} = this.useCarburetor(carburetor);

        return <div className="value">{value}</div>;
    }
}

const renderInScope = (scope: CarburetorScope) => {
    return render(
        <CarburetorProvider scope={scope}>
            <ScopedCounter/>
        </CarburetorProvider>
    );
};

describe('CarburetorScope', () => {
    test('creates one instance per token and reuses it', () => {
        const scope = new CarburetorScope();

        const first = scope.get(counterToken);
        const second = scope.get(counterToken);

        expect(first).toBe(second);
    });

    test('different scopes never share state', () => {
        const left = new CarburetorScope();
        const right = new CarburetorScope();

        left.get(counterToken).inc();

        expect(left.get(counterToken).getData().value).toEqual(1);
        expect(right.get(counterToken).getData().value).toEqual(0);
    });

    test('a component resolves its carburetor from the surrounding scope', () => {
        const scope = new CarburetorScope();
        const {container, unmount} = renderInScope(scope);

        expect(container.querySelector('.value')?.textContent).toEqual('0');

        act(() => {
            scope.get(counterToken).inc();
        });

        expect(container.querySelector('.value')?.textContent).toEqual('1');

        unmount();
    });

    test('two trees on different scopes stay independent', () => {
        const left = new CarburetorScope();
        const right = new CarburetorScope();

        const leftTree = renderInScope(left);
        const rightTree = renderInScope(right);

        act(() => {
            left.get(counterToken).inc();
        });

        expect(leftTree.container.querySelector('.value')?.textContent).toEqual('1');
        expect(rightTree.container.querySelector('.value')?.textContent).toEqual('0');

        leftTree.unmount();
        rightTree.unmount();
    });

    test('set replaces an instance, which is how a prepared store is hydrated', () => {
        const scope = new CarburetorScope();
        const prepared = new CounterCarburetor({value: 41});

        scope.set(counterToken, prepared);
        prepared.inc();

        const {container, unmount} = renderInScope(scope);

        expect(container.querySelector('.value')?.textContent).toEqual('42');

        unmount();
    });

    test('dehydrate and hydrate carry state from one scope to another', () => {
        const server = new CarburetorScope();
        server.get(counterToken).inc();
        server.get(counterToken).inc();

        // What a server would embed into the page.
        const wire = JSON.stringify(server.dehydrate());

        const client = new CarburetorScope();
        client.hydrate(JSON.parse(wire), [counterToken]);

        expect(client.get(counterToken).getData().value).toEqual(2);
    });

    test('hydrated scopes stay independent afterwards', () => {
        const server = new CarburetorScope();
        server.get(counterToken).inc();

        const state = server.dehydrate();

        const first = new CarburetorScope();
        const second = new CarburetorScope();
        first.hydrate(state, [counterToken]);
        second.hydrate(state, [counterToken]);

        first.get(counterToken).inc();

        expect(first.get(counterToken).getData().value).toEqual(2);
        expect(second.get(counterToken).getData().value).toEqual(1);
        expect(server.get(counterToken).getData().value).toEqual(1);
    });

    test('dehydrate only covers carburetors the scope actually created', () => {
        const scope = new CarburetorScope();

        expect(scope.dehydrate()).toEqual({});

        scope.get(counterToken);

        expect(Object.keys(scope.dehydrate())).toEqual([counterToken.id]);
    });

    test('hydrate ignores tokens missing from the payload', () => {
        const scope = new CarburetorScope();

        scope.hydrate({}, [counterToken]);

        expect(scope.has(counterToken)).toBeFalsy();
    });

    test('a payload key no token claims is reported in development', () => {
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const scope = new CarburetorScope();

            scope.hydrate({[counterToken.id]: {value: 5}, 'stale-name': {value: 9}}, [counterToken]);

            expect(scope.get(counterToken).getData().value).toEqual(5);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0][0])).toContain('stale-name');
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('a hydrated component renders the server state', () => {
        const server = new CarburetorScope();
        server.get(counterToken).inc();

        const client = new CarburetorScope();
        client.hydrate(JSON.parse(JSON.stringify(server.dehydrate())), [counterToken]);

        const {container, unmount} = renderInScope(client);

        expect(container.querySelector('.value')?.textContent).toEqual('1');

        unmount();
    });

    test('a scoped component without a provider fails loudly', () => {
        const failing = () => render(<ScopedCounter/>);

        expect(failing).toThrow(/no scope found/);
    });

    // R4-03: `state[id] = value` on a plain `{}` would invoke the inherited `__proto__`
    // accessor setter for this id instead of storing an own key, so the wire payload
    // silently dropped the value and a client hydrated the token's default instead.
    test('a token named "__proto__" round-trips its value through JSON between independent scopes', () => {
        const protoToken = carburetorToken<CounterCarburetor>(() => new CounterCarburetor({value: 0}), '__proto__');

        const server = new CarburetorScope();
        server.get(protoToken).inc();
        server.get(protoToken).inc();
        server.get(protoToken).inc();

        const dehydrated = server.dehydrate();

        // The wire dictionary itself must carry the value as an own key, not as a
        // prototype reassignment, before it is ever stringified.
        expect(Object.prototype.hasOwnProperty.call(dehydrated, '__proto__')).toBeTruthy();
        expect(Object.getPrototypeOf(dehydrated)).toBe(Object.prototype);

        const wire = JSON.stringify(dehydrated);
        const parsedWire = JSON.parse(wire);

        // An object literal with a "__proto__" key has the very same pitfall, so the
        // expectation is built the same own-property-safe way instead of `toEqual({...})`.
        expect(Object.keys(parsedWire)).toEqual(['__proto__']);
        expect(Object.prototype.hasOwnProperty.call(parsedWire, '__proto__')).toBeTruthy();
        expect(parsedWire.__proto__).toEqual({value: 3});

        const client = new CarburetorScope();
        client.hydrate(parsedWire, [protoToken]);

        expect(client.get(protoToken).getData().value).toEqual(3);
    });

    // R15-07: get/set/has/dehydrate/hydrate were arrow fields, so a subclass method override
    // of any of them was silently ignored, and super.x() could not reach a base arrow field.
    describe('subclass method overrides', () => {
        test('get() is called and super.get still works', () => {
            const calls: string[] = [];

            class CountingScope extends CarburetorScope {
                public get<T>(token: ICarburetorToken<T>): T {
                    calls.push(token.id);

                    return super.get(token);
                }
            }

            const scope = new CountingScope();

            expect(scope.get(counterToken)).toBe(scope.get(counterToken));
            expect(calls).toEqual([counterToken.id, counterToken.id]);
        });

        test('set() is called and super.set still installs the instance', () => {
            const calls: string[] = [];

            class CountingScope extends CarburetorScope {
                public set<T>(token: ICarburetorToken<T>, instance: T): void {
                    calls.push(token.id);
                    super.set(token, instance);
                }
            }

            const scope = new CountingScope();
            const prepared = new CounterCarburetor({value: 7});

            scope.set(counterToken, prepared);

            expect(calls).toEqual([counterToken.id]);
            expect(scope.get(counterToken)).toBe(prepared);
        });

        test('has() is called and super.has still answers correctly', () => {
            const calls: string[] = [];

            class CountingScope extends CarburetorScope {
                public has<T>(token: ICarburetorToken<T>): boolean {
                    calls.push(token.id);

                    return super.has(token);
                }
            }

            const scope = new CountingScope();

            expect(scope.has(counterToken)).toBeFalsy();
            scope.get(counterToken);
            expect(scope.has(counterToken)).toBeTruthy();
            expect(calls).toEqual([counterToken.id, counterToken.id]);
        });

        test('dehydrate() is called and super.dehydrate still serializes the scope', () => {
            const calls: number[] = [];

            class CountingScope extends CarburetorScope {
                public dehydrate() {
                    calls.push(1);

                    return super.dehydrate();
                }
            }

            const scope = new CountingScope();
            scope.get(counterToken).inc();

            const state = scope.dehydrate();

            expect(calls).toEqual([1]);
            expect(state).toEqual({[counterToken.id]: {value: 1}});
        });

        test('hydrate() is called and super.hydrate still restores state', () => {
            const calls: number[] = [];

            class CountingScope extends CarburetorScope {
                public hydrate(state: Record<string, unknown>, tokens: ReadonlyArray<ICarburetorToken<unknown>>): void {
                    calls.push(1);
                    super.hydrate(state, tokens);
                }
            }

            const server = new CarburetorScope();
            server.get(counterToken).inc();
            server.get(counterToken).inc();

            const client = new CountingScope();
            client.hydrate(server.dehydrate(), [counterToken]);

            expect(calls).toEqual([1]);
            expect(client.get(counterToken).getData().value).toEqual(2);
        });
    });
});

describe('CarburetorScope.toJSON (R34-05)', () => {
    test('JSON.stringify(scope) equals JSON.stringify(scope.dehydrate()) for a plain store', () => {
        const scope = new CarburetorScope();
        scope.get(counterToken).inc();

        expect(JSON.stringify(scope)).toEqual(JSON.stringify(scope.dehydrate()));
    });

    test('JSON.stringify(scope) equals the snapshot path for a ResourceCarburetor', async () => {
        let resolve!: (value: string) => void;
        const token = carburetorToken(
            () => new ResourceCarburetor<string>(() => new Promise<string>((res) => {
                resolve = res;
            })),
            'scope-test/tojson-resource'
        );
        const scope = new CarburetorScope();
        const resource = scope.get(token);
        const loading = resource.load('args');
        resolve('value');
        await loading;
        expect(resource.getData().status).toEqual(EResourceStatus.Success);

        expect(JSON.stringify(scope)).toEqual(JSON.stringify(scope.dehydrate()));
    });

    test('toJSON is live, dehydrate is detached', () => {
        const scope = new CarburetorScope();
        const store = scope.get(counterToken);
        store.inc();

        const detached = scope.dehydrate();
        store.inc();

        expect(JSON.parse(JSON.stringify(detached))[counterToken.id].value).toEqual(1);
        expect(JSON.parse(JSON.stringify(scope))[counterToken.id].value).toEqual(2);
    });

    test('JSON.stringify(scope) never calls snapshot()', () => {
        const scope = new CarburetorScope();
        const store = scope.get(counterToken);
        const spy = rstest.spyOn(store, 'snapshot');

        JSON.stringify(scope);

        expect(spy).not.toHaveBeenCalled();
    });

    test('a token id of "__proto__" stays an own key and survives the JSON roundtrip', () => {
        const token = carburetorToken<CounterCarburetor>(
            () => new CounterCarburetor({value: 7}),
            '__proto__'
        );
        const server = new CarburetorScope();
        server.get(token);

        const payload = JSON.parse(JSON.stringify(server));
        expect(Object.prototype.hasOwnProperty.call(payload, '__proto__')).toBeTruthy();
        expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);

        const client = new CarburetorScope();
        client.hydrate(payload, [token]);
        expect(client.get(token).getData().value).toEqual(7);
    });

    test('instances that are not inspectable are skipped', () => {
        const scope = new CarburetorScope();
        scope.set(counterToken, {} as unknown as CounterCarburetor);

        expect(JSON.stringify(scope)).toEqual('{}');
    });

    test('hydrate round-trips a JSON.stringify(scope) payload', () => {
        const server = new CarburetorScope();
        server.get(counterToken).inc();
        server.get(counterToken).inc();

        const client = new CarburetorScope();
        client.hydrate(JSON.parse(JSON.stringify(server)), [counterToken]);

        expect(client.get(counterToken).getData().value).toEqual(2);
    });
});
