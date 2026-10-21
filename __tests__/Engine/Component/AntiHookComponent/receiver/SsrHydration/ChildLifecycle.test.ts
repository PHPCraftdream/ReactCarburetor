import {CarburetorScope, carburetorToken, ICarburetorToken} from '@/Carburetor';

describe('child scope lifecycle', () => {
    test('nested children dispose in reverse order before parent values, continuing on errors', () => {
        const events: string[] = [];
        const parent = new CarburetorScope();
        const base = carburetorToken(() => ({}), 'cr2/life-parent');
        parent.set(base, {dispose: () => events.push('parent')});
        const firstToken = carburetorToken(() => ({dispose: () => events.push('first')}), 'cr2/life-first');
        const badToken = carburetorToken(
            () => ({dispose: () => { events.push('bad'); throw Error('bad'); }}),
            'cr2/life-bad');
        const nestedToken = carburetorToken(() => ({dispose: () => events.push('nested')}), 'cr2/life-nested');
        const first = parent.child([firstToken]);
        first.get(firstToken);
        const bad = parent.child([badToken]);
        bad.get(badToken);
        const nested = bad.child([nestedToken]);
        nested.get(nestedToken);
        expect(() => parent.dispose()).toThrow('bad');
        expect(events).toEqual(['nested', 'bad', 'first', 'parent']);
    });

    test('closed scopes reject operations and disposed parents reject children', () => {
        const parent = new CarburetorScope();
        const token = carburetorToken(() => ({}), 'cr2/closed');
        const child = parent.child([token]);
        child.dispose();
        expect(() => child.get(token)).toThrow(/disposed/);
        expect(() => child.set(token, {})).toThrow(/disposed/);
        expect(() => child.hydrate({}, [token])).toThrow(/disposed/);
        expect(() => child.child([])).toThrow(/disposed/);
        parent.dispose();
        expect(() => parent.child([])).toThrow(/disposed/);
    });

    test('same token can resolve independently across nested scopes', () => {
        const parent = new CarburetorScope();
        const token = carburetorToken(owner => ({owner}), 'cr2/independent-scope-token');
        const child = parent.child([token]);
        expect(child.get(token).owner).toBe(child);
        expect(parent.get(token).owner).toBe(parent);
    });

    test('factory cycle across a child and its parent is rejected', () => {
        const parent = new CarburetorScope();
        let child: CarburetorScope;
        let local: ICarburetorToken<object>;
        const shared = carburetorToken(() => child.get(local), 'cr2/cycle-parent');
        local = carburetorToken(() => parent.get(shared), 'cr2/cycle-local');
        child = parent.child([local]);
        expect(() => child.get(local)).toThrow(/cycle/);
    });
});
