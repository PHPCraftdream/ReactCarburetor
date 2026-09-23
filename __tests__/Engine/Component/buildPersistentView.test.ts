import {Carburetor} from "@/Carburetor";
import {IConnection} from "@/Carburetor/Component/Models/Connection";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";

/**
 * Builds one connection with no render attempt ever open — `resolveAttemptSource` then calls
 * the resolver directly on every read, the same way an event handler or the declaration-time
 * shape probe reads it, without needing a React mount to exercise `buildPersistentView` itself.
 */
const declare = <T extends object>(source: () => Carburetor<T>) =>
    declareConnection<T>([] as IConnection[], 'test:', () => undefined, source);

describe('buildPersistentView shape probe (R3-11: a genuine resolver error must not be lost)', () => {
    test('a resolver whose first call throws a genuine unrelated error keeps it as the later mismatch\'s cause', () => {
        const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
        const bug = new Error('unrelated: config lookup blew up');
        let calls = 0;

        // The declaration-time shape probe hits this once and it throws for a reason that has
        // nothing to do with "not ready yet"; the first real read (below) calls it again and
        // gets a legitimate array root.
        const resolver = (): Carburetor<Array<{id: number}>> => {
            calls += 1;

            if (calls === 1) {
                throw bug;
            }

            return arrayStore;
        };

        const view = buildPersistentView(declare(resolver));

        let thrown: unknown;

        try {
            void (view as unknown as ReadonlyArray<{id: number}>).length;
        } catch (error) {
            thrown = error;
        }

        // The probe already consumed the resolver's one throw, so the read below observes a
        // real declared/resolved kind mismatch: object-shaped (the probe saw nothing), array-shaped.
        expect(calls).toEqual(2);
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('array');
        // Not silently discarded behind the generic "not resolvable at declaration time"
        // wording: the original bug survives as the thrown error's cause.
        expect((thrown as Error).cause).toBe(bug);
    });

    test('a resolver that only ever reports "not ready yet" still declares and reads normally, unaffected', () => {
        const objectStore = new Carburetor<{value: number}>({value: 0});
        let calls = 0;

        // The legitimate deferred case (a scope-backed resolver before context is filled in):
        // throws once, then consistently resolves to the same, declared kind.
        const resolver = (): Carburetor<{value: number}> => {
            calls += 1;

            if (calls === 1) {
                throw new Error('not ready yet');
            }

            return objectStore;
        };

        const view = buildPersistentView(declare(resolver));

        expect(view.value).toEqual(0);
        expect(calls).toEqual(2);

        objectStore.setData({value: 1});

        expect(view.value).toEqual(1);
    });

    test('a probe that never throws reports a genuine later kind change without a cause (unchanged behavior)', () => {
        type TFlex = {id: number} | ReadonlyArray<{id: number}>;

        const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
        const objectStore = new Carburetor<{id: number}>({id: 1});
        let useArray = false;

        const resolver = (): Carburetor<TFlex> =>
            (useArray ? arrayStore : objectStore) as unknown as Carburetor<TFlex>;

        const view = buildPersistentView(declare(resolver));

        expect((view as {id: number}).id).toEqual(1);

        useArray = true;

        let thrown: unknown;

        try {
            void (view as unknown as ReadonlyArray<{id: number}>).length;
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).cause).toBeUndefined();
    });
});
