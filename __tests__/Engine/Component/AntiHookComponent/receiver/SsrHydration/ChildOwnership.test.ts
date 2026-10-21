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
});
