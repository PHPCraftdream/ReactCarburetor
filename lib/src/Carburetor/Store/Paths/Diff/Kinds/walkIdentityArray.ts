import {PATCH_ARRAY_LENGTH_LOCK, PATCH_OPAQUE, TPathSet, TPatchRecorder} from '@/Carburetor/Models/Paths';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';
import {keysPath} from '@/Carburetor/Store/Paths/Markers/KeysMarker';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {clonePatchValue} from '@/Carburetor/Store/Tracking/Proxy/clonePatchValue';
import {ArrayIdentity} from './ArrayIdentity';
import {probesSparse} from './probesSparse';
import {hasRepeatedContainer} from './hasRepeatedContainer';

interface IHost {
    add(path: string): void;
    child(previous: unknown, next: unknown, key: string, recorder?: TPatchRecorder): void;
}

/** R39-05: array structural paths spend no genuine-leaf budget; replacements still descend.
 *
 * @param previous - Old raw array.
 * @param next - Assigned array.
 * @param path - Tracked array path.
 * @param segments - Unescaped path keys.
 * @param into - Changed path set.
 * @param onPatch - Optional patch receiver.
 * @param host - Leaf traversal and budget. */
export const walkIdentityArray = (
    previous: unknown[], next: unknown[], path: string, segments: readonly string[],
    into: TPathSet, onPatch: TPatchRecorder | undefined, host: IHost
): void => {
    const identity = new ArrayIdentity(previous, next);
    const before = into.size;
    const oldLength = Object.getOwnPropertyDescriptor(previous, 'length')!;
    const newLength = Object.getOwnPropertyDescriptor(next, 'length')!;
    const patches: Parameters<TPatchRecorder>[0][] | undefined = onPatch ? [] : undefined;
    let graphChecked = false;
    let opaque = false;
    let moved = false;
    let keysChanged = false;
    let restricted = false;
    const record: TPatchRecorder | undefined = patches ? patch => { patches.push(patch); } : undefined;
    const patch = (key: string, old: unknown, value: unknown, oldOwn: boolean, newOwn: boolean): void => {
        if (!patches || opaque) return;
        patches.push({segments: [...segments, key], previousExists: oldOwn, previous: clonePatchValue(old),
            nextExists: newOwn, next: clonePatchValue(value)});
    };
    const visit = (key: string | number): void => {
        const old = (previous as unknown as Record<string, unknown>)[key];
        let value = (next as unknown as Record<string, unknown>)[key];
        const oldOwn = old !== undefined || Object.prototype.hasOwnProperty.call(previous, key);
        const newOwn = value !== undefined || Object.prototype.hasOwnProperty.call(next, key);
        if (oldOwn === newOwn && Object.is(old, value)) return;
        if (value !== null && typeof value === 'object') {
            const raw = liveViews.readTarget(value);
            if (raw !== undefined) (next as unknown as Record<string, unknown>)[key] = value = raw;
        }
        if (oldOwn === newOwn && Object.is(old, value)) return;
        const positional = (typeof key === 'number' || /^(0|[1-9]\d*)$/.test(key)) && identity.moved(old, value);
        const name = String(key);
        if (positional) {
            moved = true;
            if (patches && !graphChecked) {
                graphChecked = true;
                opaque = hasRepeatedContainer(previous) || hasRepeatedContainer(next);
                if (opaque) patches.length = 0;
            }
        }
        if (!oldOwn || !newOwn || positional) {
            keysChanged ||= oldOwn !== newOwn;
            if (positional) into.add(joinPath(path, name));
            else host.add(joinPath(path, name));
            patch(name, old, value, oldOwn, newOwn);
        } else {
            host.child(old, value, name, opaque ? undefined : record);
        }
        if (newOwn && patches && !restricted) {
            const descriptor = Object.getOwnPropertyDescriptor(next, key)!;
            restricted = descriptor.writable === false || descriptor.configurable === false;
        }
    };
    const limit = Math.max(previous.length, next.length);
    if (limit > 4096 && (probesSparse(previous) || probesSparse(next))) {
        const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const key of keys) visit(key);
    } else {
        for (let index = 0; index < limit; index++) visit(index);
    }
    if (oldLength.value !== newLength.value || oldLength.writable !== newLength.writable) {
        if (moved) into.add(joinPath(path, 'length'));
        else host.add(joinPath(path, 'length'));
        if (oldLength.value !== newLength.value) {
            patch('length', oldLength.value, newLength.value, true, true);
            if (!moved && patches && !opaque) patches.unshift(patches.pop()!);
        }
        if (oldLength.writable !== newLength.writable) record?.(PATCH_ARRAY_LENGTH_LOCK);
    }
    if (keysChanged) {
        if (moved) into.add(keysPath(path));
        else host.add(keysPath(path));
    }
    if (into.size > before && (opaque || restricted)) onPatch?.(PATCH_OPAQUE);
    if (!opaque) patches?.forEach(p => onPatch?.(p));
};
