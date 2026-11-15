import {rstest} from '@rstest/core';
import {CarburetorScope, carburetorToken} from '@/Carburetor';

describe('child scope ownership', () => {
    test('lazy local hydration is local, dehydration omits delegated values, and set wins', () => {
        const make = () => ({value: 0, fromJSON(state: {value: number}) { this.value = state.value; },
            snapshot() { return {value: this.value}; }, toJSON() { return {value: this.value}; }});
        const local = carburetorToken(make, 'cr2/lazy-local');
        const delegated = carburetorToken(() => ({value: 2}), 'cr2/lazy-delegated');
        const parent = new CarburetorScope();
        parent.get(delegated);
        const child = parent.child([local]);
        child.get(delegated);
        child.hydrate({[local.id]: {value: 8}});
        expect(child.get(local).value).toBe(8);
        expect(child.dehydrate()).toEqual({[local.id]: {value: 8}});
        expect(parent.dehydrate()).toEqual({});
        child.get(delegated);
        child.set(delegated, {value: 9});
        expect(child.get(delegated).value).toBe(9);
    });

    test('eager nonlocal hydration does not mutate or claim parent instance', () => {
        const make = () => ({value: 0, fromJSON(state: {value: number}) { this.value = state.value; },
            snapshot() { return {value: this.value}; }, toJSON() { return {value: this.value}; }});
        const token = carburetorToken(make, 'cr2/child-eager-nonlocal');
        const parent = new CarburetorScope();
        const original = {value: 1, fromJSON(state: {value: number}) { this.value = state.value; },
            snapshot() { return {value: this.value}; }, toJSON() { return {value: this.value}; }};
        parent.set(token, original);
        const child = parent.child([]);
        const error = rstest.spyOn(console, 'error').mockImplementation(() => {});
        child.hydrate({[token.id]: {value: 9}}, [token]);
        error.mockRestore();
        expect(parent.get(token).value).toBe(1);
        expect(child.has(token)).toBe(false);
    });

    test('nonlocal set shadows only the child', () => {
        const token = carburetorToken(() => ({value: 0}), 'cr2/child-shadow');
        const parent = new CarburetorScope();
        const original = {value: 1};
        const shadow = {value: 2};
        parent.set(token, original);
        const child = parent.child([]);
        child.set(token, shadow);
        expect(child.get(token)).toBe(shadow);
        expect(parent.get(token)).toBe(original);
    });

    test('eager nonlocal hydration does not mutate the parent instance', () => {
        const make = () => ({value: 0, fromJSON(state: {value: number}) { this.value = state.value; },
            snapshot() { return {value: this.value}; }, toJSON() { return {value: this.value}; }});
        const token = carburetorToken(make, 'cr2/child-hydrate');
        const parent = new CarburetorScope();
        const original = {value: 1, fromJSON(state: {value: number}) { this.value = state.value; },
            snapshot() { return {value: this.value}; }, toJSON() { return {value: this.value}; }};
        parent.set(token, original);
        const child = parent.child([token]);
        child.hydrate({[token.id]: {value: 9}}, [token]);
        expect(child.get(token).value).toBe(9);
        expect(parent.get(token).value).toBe(1);
    });

    test('delegated undefined is cached rather than repeatedly resolved', () => {
        let calls = 0;
        const token = carburetorToken(() => { calls++; return undefined; }, 'cr2/undefined');
        const parent = new CarburetorScope();
        const child = parent.child([]);
        child.get(token);
        child.get(token);
        expect(calls).toBe(1);
    });

    test('every child scope is an instance of one class, each with its own parent and local tokens', () => {
        const first = carburetorToken(() => ({name: 'first'}), 'cr2/shape-first');
        const second = carburetorToken(() => ({name: 'second'}), 'cr2/shape-second');
        const shared = carburetorToken(() => ({name: 'shared'}), 'cr2/shape-shared');
        const parentA = new CarburetorScope();
        const parentB = new CarburetorScope();
        const childA = parentA.child([first]);
        const childB = parentB.child([second]);

        expect(Object.getPrototypeOf(childA)).toBe(Object.getPrototypeOf(childB));
        expect(childA).toBeInstanceOf(CarburetorScope);
        expect(Object.getPrototypeOf(childA)).not.toBe(CarburetorScope.prototype);

        // Local tokens stay local to their own child; everything else resolves through its own parent.
        expect(childA.get(first)).not.toBe(parentA.get(first));
        expect(childB.get(first)).toBe(parentB.get(first));
        expect(childA.get(shared)).toBe(parentA.get(shared));
        expect(childB.get(shared)).toBe(parentB.get(shared));
        expect(childA.get(shared)).not.toBe(childB.get(shared));

        childA.dispose();
        expect(() => childA.get(first)).toThrow('CarburetorScope: scope is disposed');
        expect(childB.get(second).name).toBe('second');
    });
});
