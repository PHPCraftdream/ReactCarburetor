import {CarburetorScope, carburetorToken} from '@/Carburetor';

describe('CarburetorScope child scopes', () => {
    test('child creates local values and delegates/caches nonlocal values', () => {
        const parent = new CarburetorScope();
        let creates = 0;
        const shared = carburetorToken(() => ({n: ++creates}), 'scope-child/shared');
        const local = carburetorToken(owner => ({owner}), 'scope-child/local');
        const child = parent.child([local]);
        expect(child.get(shared)).toBe(parent.get(shared));
        expect(child.get(shared)).toBe(parent.get(shared));
        expect(creates).toBe(1);
        expect(child.has(shared)).toBe(false);
        expect(child.has(local)).toBe(false);
        expect(child.get(local).owner).toBe(child);
        expect(child.has(local)).toBe(true);
    });

    test('sets shadow in child; child disposal is local and parents dispose children in reverse order', () => {
        const events: string[] = [];
        const token = carburetorToken(() => ({dispose: () => events.push('parent')}), 'scope-child/life');
        const parent = new CarburetorScope();
        parent.set(token, {dispose: () => events.push('parent')});
        const firstToken = carburetorToken(() => ({dispose: () => events.push('first')}), 'scope-child/first');
        const secondToken = carburetorToken(() => ({dispose: () => events.push('second')}), 'scope-child/second');
        const first = parent.child([firstToken]);
        first.get(firstToken);
        const second = parent.child([secondToken]);
        second.get(secondToken);
        first.dispose();
        expect(events).toEqual(['first']);
        parent.dispose();
        expect(events).toEqual(['first', 'second', 'parent']);
    });

    test('factory resolution rejects cross-parent dependency cycles', () => {
        const parent = new CarburetorScope();
        const child = parent.child([]);
        let parentToken: ReturnType<typeof carburetorToken<object>>;
        let childToken: ReturnType<typeof carburetorToken<object>>;
        parentToken = carburetorToken(() => child.get(childToken), 'scope-child/cycle-parent');
        childToken = carburetorToken(() => parent.get(parentToken), 'scope-child/cycle-child');
        expect(() => parent.get(parentToken)).toThrow(/cycle/);
    });
});
