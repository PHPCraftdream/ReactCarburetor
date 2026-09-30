import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';

/** Detaches plain patch values without normalizing restrictions needed by owned history.
 *
 * Opaque leaves retain their existing reference boundary; ordinary snapshots use deepClone.
 *
 * @param value - the original mutation endpoint.
 */
export const clonePatchValue = (value: unknown): unknown => {
    if (!isTrackable(value)) return value;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const result: object = array ? [] : Object.create(prototype);
    if (array && prototype !== Array.prototype) Object.setPrototypeOf(result, prototype);
    const target = result as Record<string, unknown>;
    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        descriptor.value = clonePatchValue(descriptor.value);
        if (descriptor.writable && descriptor.configurable && !(key in target)) {
            target[key] = descriptor.value;
        } else {
            Object.defineProperty(result, key, descriptor);
        }
    }
    if (array) Object.defineProperty(result, 'length', Object.getOwnPropertyDescriptor(value, 'length')!);
    return result;
};
