import {IResourceResolution, IResourceView} from '@/Carburetor/Models/Resource';
import {TPath, TPathRecorder} from '@/Carburetor/Models/Paths';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';

/** A captured field facade with shared traps and own enumerable field values.
 *
 * @param resolution - resource fields and path captured by this resolution.
 * @param record - records reads of fields not locally overridden.
 */
export const createResourceFieldView = <T>(
    resolution: IResourceResolution<T>, record: TPathRecorder
): IResourceView<T> => new Proxy({...resolution.view}, new FieldHandler(resolution.path, record));

/** The target is a local copy: overrides never write back into a cache snapshot. */
class FieldHandler<T> implements ProxyHandler<IResourceView<T>> {
    /** Local override keys, allocated lazily so ordinary field reads need no Set. */
    private overrides: Set<PropertyKey> | undefined;

    /** Captures the entry path and this facade's recorder.
     *
     * @param path - captured entry path.
     * @param record - records fields read before they are locally overridden.
     */
    constructor(private readonly path: TPath, private readonly record: TPathRecorder) {}

    /** Assigns a local value without changing the captured cache entry.
     *
     * @param target - facade's own field copy.
     * @param key - field being assigned.
     * @param value - replacement local value.
     */
    public set(target: IResourceView<T>, key: string | symbol, value: unknown): boolean {
        const changed = Reflect.set(target, key, value);
        if (changed) (this.overrides ??= new Set<PropertyKey>()).add(key);
        return changed;
    }

    /** Defines a local property while preserving ordinary descriptor semantics.
     *
     * @param target - facade's own field copy.
     * @param key - property being defined.
     * @param descriptor - requested local descriptor.
     */
    public defineProperty(target: IResourceView<T>, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        const changed = Reflect.defineProperty(target, key, descriptor);
        if (changed) (this.overrides ??= new Set<PropertyKey>()).add(key);
        return changed;
    }

    /** Deletes only the local field, never the captured cache property.
     *
     * @param target - facade's own field copy.
     * @param key - property being removed.
     */
    public deleteProperty(target: IResourceView<T>, key: string | symbol): boolean {
        const changed = Reflect.deleteProperty(target, key);
        if (changed) (this.overrides ??= new Set<PropertyKey>()).add(key);
        return changed;
    }

    /** Reads an own captured field at field-specific dependency precision.
     *
     * @param target - facade's own field copy.
     * @param key - requested property.
     * @param receiver - receiver forwarded for local accessors.
     */
    public get(target: IResourceView<T>, key: string | symbol, receiver: unknown): unknown {
        if (typeof key === 'string' && !this.overrides?.has(key)
            && Object.prototype.hasOwnProperty.call(target, key)) {
            if (key === 'stale') {
                this.record(joinPath(this.path, 'invalidated'));
                this.record(joinPath(this.path, 'updatedAt'));
            } else {
                this.record(joinPath(this.path, key));
                if (key === 'refreshing') this.record(joinPath(this.path, 'updatedAt'));
            }
        }
        return Reflect.get(target, key, receiver);
    }
}
