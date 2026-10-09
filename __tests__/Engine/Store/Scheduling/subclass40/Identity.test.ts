import {Carburetor, computed} from '@/Carburetor';

/** Server document versions must not replace the engine's freshness counter (R40-01). */
class DocumentStore extends Carburetor<{title: string}> {
    public version = 0;

    /** Saves a title and remembers the server's version. */
    public save(title: string, serverVersion: number): void {
        this.update(draft => { draft.title = title; });
        this.version = serverVersion;
    }
}

/** Domain identities must not merge independent computed dependencies (R40-01). */
class Profile extends Carburetor<{name: string}> {
    public uid = 'profile';

    /** Publishes a profile rename. */
    public rename(name: string): void {
        this.update(draft => { draft.name = name; });
    }
}

describe('R40-01 store subclass identities', () => {
    test('A: three saves with server version 7 keep an unobserved computed fresh', () => {
        const store = new DocumentStore({title: 'a'});
        const upper = computed(read => read(store).title.toUpperCase());
        const seen = [upper.get()];
        const versions = [store.getVersion()];

        for (const title of ['b', 'c', 'd']) {
            store.save(title, 7);
            seen.push(upper.get());
            versions.push(store.getVersion());
        }

        expect(store.getData().title).toBe('d');
        expect(seen).toEqual(['A', 'B', 'C', 'D']);
        expect(versions).toEqual([0, 1, 2, 3]);
        expect(store.version).toBe(7);
    });

    test('B: colliding domain uids still deliver the second store exactly once', () => {
        const me = new Profile({name: 'me'});
        const friend = new Profile({name: 'friend'});
        const pair = computed(read => `${read(me).name} & ${read(friend).name}`);
        const seen: string[] = [];
        const id = pair.subscribe(() => seen.push(pair.get()));

        expect(pair.get()).toBe('me & friend');
        friend.rename('friend2');

        expect(friend.getData().name).toBe('friend2');
        expect(seen).toEqual(['me & friend2']);
        expect(pair.get()).toBe('me & friend2');
        expect(me.getUID()).not.toBe(friend.getUID());
        expect(me.uid).toBe(friend.uid);
        pair.unsubscribe(id);
    });
});
