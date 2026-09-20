import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    carburetorToken,
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

const counterToken = carburetorToken<CounterCarburetor>(() => new CounterCarburetor({value: 0}));

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
});
