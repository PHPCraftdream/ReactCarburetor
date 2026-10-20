import {Carburetor, CarburetorScope, carburetorToken, ICarburetorToken} from "@/Carburetor";

class LifecycleStore extends Carburetor<{value: number}> {
    public constructor() { super({value: 0}); }
    public didDisposeCalls = 0;
    protected didDispose(): void { super.didDispose(); this.didDisposeCalls++; }
}

describe('CarburetorScope lifecycle', () => {
    test('deduplicates ownership by first occurrence when factories return shared objects', () => {
        const calls: string[] = [];
        const x = {dispose: (): void => { calls.push('X'); }};
        const y = {dispose: (): void => { calls.push('Y'); }};
        const a = carburetorToken(() => x, 'scope-lifecycle/alias-a');
        const b = carburetorToken(() => y, 'scope-lifecycle/alias-b');
        const c = carburetorToken(() => x, 'scope-lifecycle/alias-c');
        const scope = new CarburetorScope();
        scope.get(a); scope.get(b); scope.get(c);
        scope.dispose();
        expect(calls).toEqual(['Y', 'X']);
    });

    test('factory receives its creating scope', () => {
        const scope = new CarburetorScope();
        const token = carburetorToken((owner: CarburetorScope) => {
            expect(owner).toBe(scope);
            return new LifecycleStore();
        }, 'scope-lifecycle/factory-scope');
        expect(scope.get(token)).toBeInstanceOf(LifecycleStore);
    });

    test('factory resolves a real dependency from its owner', () => {
        const dependency = new LifecycleStore();
        const dependencyToken = carburetorToken(() => dependency, 'scope-lifecycle/factory-dependency');
        const parentToken = carburetorToken(
            (owner: CarburetorScope) => ({dependency: owner.get(dependencyToken)}),
            'scope-lifecycle/factory-parent',
        );
        const scope = new CarburetorScope();
        expect(scope.get(parentToken).dependency).toBe(dependency);
    });

    test('dependency cycles report a named chain and permit a later retry', () => {
        let scope!: CarburetorScope;
        let resolved = false;
        const a: ICarburetorToken<object> = carburetorToken((owner: CarburetorScope): object =>
            resolved ? {ready: true} : owner.get(b), 'scope-lifecycle/cycle-a');
        const b: ICarburetorToken<object> = carburetorToken((owner: CarburetorScope): object => owner.get(a),
            'scope-lifecycle/cycle-b');
        scope = new CarburetorScope();
        expect(() => scope.get(a)).toThrow(
            /scope-lifecycle\/cycle-a.*scope-lifecycle\/cycle-b.*scope-lifecycle\/cycle-a/,
        );
        expect(scope.has(a)).toBe(false);
        expect(scope.has(b)).toBe(false);
        expect(() => scope.get(a)).toThrow(/dependency cycle/);
        resolved = true;
        expect(scope.get(a)).toEqual({ready: true});
    });

    test('dispose is reverse creation order and disposes replaced instances only once', () => {
        const order: string[] = [];
        class Tracked extends LifecycleStore {
            public constructor(private readonly name: string, private readonly fail = false) { super(); }
            protected didDispose(): void {
                order.push(this.name);
                super.didDispose();
                if (this.fail) throw new Error('dispose ' + this.name);
            }
        }
        const scope = new CarburetorScope();
        const one = carburetorToken(() => new Tracked('one'), 'scope-lifecycle/owned-one');
        const two = carburetorToken(() => new Tracked('two', true), 'scope-lifecycle/owned-two');
        const replacement = new Tracked('replacement');
        scope.get(one);
        scope.get(two);
        scope.set(one, replacement);
        expect(() => scope.dispose()).toThrow('dispose two');
        scope.dispose();
        expect(order).toEqual(['replacement', 'two', 'one']);
        expect(() => scope.get(one)).toThrow(/disposed/);
    });

    test('hydrate and set retain ownership and reject use after disposal', () => {
        const server = new CarburetorScope();
        const token = carburetorToken(() => new LifecycleStore(), 'scope-lifecycle/hydrated');
        server.get(token);
        const client = new CarburetorScope();
        client.hydrate(server.dehydrate(), [token]);
        const hydrated = client.get(token);
        const prepared = new LifecycleStore();
        client.set(token, prepared);
        client.dispose();
        expect(hydrated.didDisposeCalls).toBe(1);
        expect(prepared.didDisposeCalls).toBe(1);
        expect(() => client.set(token, new LifecycleStore())).toThrow(/disposed/);
        expect(() => client.hydrate({}, [token])).toThrow(/disposed/);
    });

    test('a failing lazy hydration remains owned until scope disposal', () => {
        class FailedHydration extends LifecycleStore {
            public fromJSON(): void { throw new Error('hydrate failed'); }
        }
        const failed = new FailedHydration();
        const token = carburetorToken(() => failed, 'scope-lifecycle/failed-hydration-owned');
        const scope = new CarburetorScope();
        scope.hydrate({[token.id]: {value: 1}});
        expect(() => scope.get(token)).toThrow('hydrate failed');
        expect(scope.has(token)).toBe(false);
        scope.dispose();
        expect(failed.didDisposeCalls).toBe(1);
    });

    test('disposal during lazy hydration disposes the created instance and rejects it', () => {
        const created = new LifecycleStore();
        const token = carburetorToken(() => created, 'scope-lifecycle/disposed-during-hydration');
        const scope = new CarburetorScope();
        scope.hydrate({[token.id]: {value: 1}});
        created.fromJSON = (): void => { scope.dispose(); };
        expect(() => scope.get(token)).toThrow(/disposed/);
        expect(created.didDisposeCalls).toBe(1);
        expect(() => scope.get(token)).toThrow(/disposed/);
    });

    test('disposing during factory execution disposes the returned instance and rejects it', () => {
        let scope!: CarburetorScope;
        const created = new LifecycleStore();
        const token: ICarburetorToken<LifecycleStore> = carburetorToken((owner: CarburetorScope) => {
            owner.dispose();
            return created;
        }, 'scope-lifecycle/reentrant-dispose');
        scope = new CarburetorScope();
        expect(() => scope.get(token)).toThrow(/disposed/);
        expect(created.didDisposeCalls).toBe(1);
        expect(scope.has(token)).toBe(false);
    });
});
