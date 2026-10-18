import {IResourceResolution, IResourceView} from '@/Carburetor/Models/Resource';
import {TPathRecorder} from '@/Carburetor/Models/Paths';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
/** A captured field facade with shared traps and own enumerable field values.
 *
 * @param resolution - resource fields and path captured by this resolution.
 * @param record - records reads of fields not locally overridden.
 */
export const createResourceFieldView = <T>(
    resolution: IResourceResolution<T>, record: TPathRecorder
): IResourceView<T> => new Proxy({...resolution.view}, new FieldHandler(resolution, record));

/** The target is a local copy: writes are rejected, reads subscribe to whole fields. */
class FieldHandler<T> implements ProxyHandler<IResourceView<T>> {

    /** Captures the entry resolution and this facade's recorder.
     *
     * @param resolution - resource fields and path captured by this resolution.
     * @param record - records fields read before they are locally overridden.
     */
    constructor(private readonly resolution: IResourceResolution<T>, private readonly record: TPathRecorder) {}

    /** Rejects assignment: a resource view is readonly.
     *
     * @param _target - the facade's own empty target; unused.
     * @param _key - field being assigned; unused because the trap throws.
     */
    public set(_target: IResourceView<T>, _key: string | symbol): boolean {
        throw new TypeError('a resource view is readonly; write the store, not the reader facade.');
    }

    /** Rejects property definition: a resource view is readonly.
     *
     * @param _target - the facade's own empty target; unused.
     * @param _key - property being defined; unused because the trap throws.
     */
    public defineProperty(_target: IResourceView<T>, _key: string | symbol): boolean {
        throw new TypeError('a resource view is readonly; write the store, not the reader facade.');
    }

    /** Rejects deletion: a resource view is readonly.
     *
     * @param _target - the facade's own empty target; unused.
     * @param _key - property being removed; unused because the trap throws.
     */
    public deleteProperty(_target: IResourceView<T>, _key: string | symbol): boolean {
        throw new TypeError('a resource view is readonly; write the store, not the reader facade.');
    }

    /** Reads an own captured field, subscribing to the whole field path.
     *
     * @param target - facade's own field copy.
     * @param key - requested property.
     * @param receiver - receiver forwarded for local accessors.
     */
    public get(target: IResourceView<T>, key: string | symbol, receiver: unknown): unknown {
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key)) {
            if (key === 'stale') {
                this.record(resourceReader.fieldPath(this.resolution.path, 'invalidated'));
                this.record(resourceReader.fieldPath(this.resolution.path, 'updatedAt'));
            } else {
                this.record(resourceReader.fieldPath(this.resolution.path, key));
                if (key === 'refreshing') this.record(resourceReader.fieldPath(this.resolution.path, 'updatedAt'));
            }
        }
        return Reflect.get(target, key, receiver);
    }
}
