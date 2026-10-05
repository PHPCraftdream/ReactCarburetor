import {IResourceView} from '@/Carburetor/Models/Resource';
import {TPath} from '@/Carburetor/Models/Paths';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

/**
 * A test seam that re-opens the protected key/path members of ResourceCache.
 *
 * R33-08 made keyOf, pathOf, pathOfKey and getEntryByKey protected, because the public contract
 * is resolve(). The suites that pin the key memo and path-escaping semantics still need to call
 * them directly, so this subclass exposes them under explicit `expose*` names without widening
 * the shipped class.
 */
export class TestCache<T, TArgs = void> extends ResourceCache<T, TArgs> {
    /** The cache key for one argument set, as the key memo derives it.
     *
     * @param args - the loader arguments identifying the entry
     */
    public exposeKeyOf(args: TArgs): string {
        return this.keyOf(args);
    }

    /** The read path for one argument set.
     *
     * @param args - the loader arguments identifying the entry
     */
    public exposePathOf(args: TArgs): TPath {
        return this.pathOf(args);
    }

    /** The read path for an already-derived cache key.
     *
     * @param key - the cache key the path is built from
     */
    public exposePathOfKey(key: string): TPath {
        return this.pathOfKey(key);
    }

    /** The entry view for an already-derived cache key, bypassing key derivation.
     *
     * @param key - the cache key of the entry
     */
    public exposeGetEntryByKey(key: string): IResourceView<T> {
        return this.getEntryByKey(key);
    }
}
