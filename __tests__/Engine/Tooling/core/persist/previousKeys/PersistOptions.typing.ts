// Type-only checks for the generic IPersistOptions<T>: prune inference from the store.
// Runtime behavior is covered by the ordinary suites under Engine/Tooling/core/persist.
import {Carburetor, IPersistOptions, IStorageLike, persist} from '@/Carburetor';

interface IProfile {
    name: string;
    age: number;
}

const storage: IStorageLike = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
};

// prune infers current and merge's result from the store: no cast, and current is the data type.
{
    const store = new Carburetor<IProfile>({name: 'a', age: 1});
    persist(store, {
        key: 'profile',
        storage,
        prune: (saved, current, merge) => {
            const check: IProfile = current;
            void check;
            return merge(saved);
        },
    });
}

// Returning something that is not T is an error.
{
    const store = new Carburetor<IProfile>({name: 'a', age: 1});
    persist(store, {
        key: 'profile',
        storage,
        // @ts-expect-error prune must return the store's data type
        prune: (saved, _current, _merge) => saved,
    });
}

// merge(saved) is assignable to T; the unannotated callback return is checked against T.
{
    const store = new Carburetor<IProfile>({name: 'a', age: 1});
    persist(store, {
        key: 'profile',
        storage,
        prune: (saved, current, merge) => {
            const merged: IProfile = merge(saved);
            return {...current, ...merged};
        },
    });
}

// A pre-annotated options object still passes to persist when annotated with the store's type.
// Note: the bare default `IPersistOptions` (T = unknown) does NOT round-trip into a typed persist
// call: prune's callback return is covariant, so under strictFunctionTypes `IPersistOptions<unknown>`
// is not assignable to `IPersistOptions<T>` — annotate the options with the store's data type.
{
    const store = new Carburetor<IProfile>({name: 'a', age: 1});
    const options: IPersistOptions<IProfile> = {key: 'profile', storage};
    persist(store, options);
}

// onCorrupt and throttleMs keep their types.
{
    const store = new Carburetor<IProfile>({name: 'a', age: 1});
    const options: IPersistOptions<IProfile> = {
        key: 'profile',
        storage,
        throttleMs: 50,
        onCorrupt: 'reset',
    };
    persist(store, options);
    const bad: IPersistOptions<IProfile> = {
        key: 'profile',
        storage,
        // @ts-expect-error onCorrupt is 'keep' | 'reset'
        onCorrupt: 'drop',
    };
    void bad;
}
