import {
    PATCH_ARRAY_LENGTH_LOCK, PATCH_OPAQUE, TAliasLedger, TPath, TPatchPort, TPatchRecorder,
    TWriteRecorder,
} from '@/Carburetor/Models/Paths';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';
import {keysPath} from '@/Carburetor/Store/Paths/Markers/KeysMarker';
import {invalidateTruncatedOwnership} from '@/Carburetor/Store/Tracking/Aliases/invalidateTruncatedOwnership';
import {clonePatchValue} from '@/Carburetor/Store/Tracking/Proxy/clonePatchValue';
import {deliverPatches} from '@/Carburetor/Store/Tracking/Proxy/deliverPatches';

/** Native ArraySetLength can delete a suffix even when it ultimately refuses the request.
 *
 * @param array - the raw draft array.
 * @param value - requested length.
 * @param descriptor - optional native definition.
 * @param basePath - the array's tracked path.
 * @param basePathSegments - its unescaped path keys.
 * @param record - effective write attribution, carrying the raw mutated array.
 * @param aliases - development alias validation.
 * @param patchPort - current mutation observers.
 * @param root - optional raw draft root for native ownership invalidation.
 */
export const writeArrayLength = (
    array: unknown[], value: unknown, descriptor: PropertyDescriptor | undefined,
    basePath: TPath, basePathSegments: readonly string[], record: TWriteRecorder,
    aliases: TAliasLedger | undefined, patchPort: TPatchPort | undefined, root?: object
): boolean => {
    const validNumber = typeof value === 'number' && Number.isInteger(value)
        && value >= 0 && value <= 0xFFFFFFFF;
    if (!descriptor && !validNumber && Object.getOwnPropertyDescriptor(array, 'length')?.writable === false) {
        return Reflect.set(array, 'length', value);
    }
    const uint32 = validNumber ? value as number : (value as number) >>> 0;
    if (!validNumber && uint32 !== +(value as number)) {
        throw new RangeError('Invalid array length');
    }

    const previousLength = array.length;
    const previousWritable = Object.getOwnPropertyDescriptor(array, 'length')!.writable!;
    const listener = patchPort?.listener;
    const concrete = listener && !patchPort?.opaque ? listener : undefined;
    let removed: Array<number | string> | undefined;
    let removedValues: unknown[] | undefined;
    let removedAny = false;
    let denseStart: number | undefined;
    const patches: Parameters<TPatchRecorder>[0][] | undefined = concrete ? [] : undefined;
    const queue: TPatchRecorder | undefined = patches ? patch => { patches.push(patch); } : undefined;

    if (uint32 < previousLength) {
        const range = previousLength - uint32;
        if (!concrete && range >= 64 && range <= 4096) {
            const ownKeys = Object.keys(array);
            if (ownKeys.length === previousLength && ownKeys[previousLength - 1] === String(previousLength - 1)) {
                denseStart = uint32;
            }
        }
        if (denseStart === undefined) {
            removed = [];
            if (concrete) removedValues = [];
            if (range <= 4096) {
                for (let index = uint32; index < previousLength; index++) {
                    if (Object.prototype.hasOwnProperty.call(array, index)) {
                        removed.push(index);
                        removedValues?.push(array[index]);
                    }
                }
            } else {
                for (const key of Object.keys(array)) {
                    const index = Number(key);
                    if (Number.isInteger(index) && index >= uint32 && index < previousLength
                        && String(index) === key) {
                        removed.push(key);
                        removedValues?.push(array[index]);
                    }
                }
            }
        }
    }

    const wrote = descriptor
        ? Reflect.defineProperty(array, 'length', 'value' in descriptor
            ? {...descriptor, value: uint32} : descriptor)
        : Reflect.set(array, 'length', uint32);
    const nextLength = array.length;
    invalidateTruncatedOwnership(root, previousLength, nextLength);
    const writableChanged = Object.getOwnPropertyDescriptor(array, 'length')!.writable !== previousWritable;
    if (denseStart !== undefined) {
        for (let index = denseStart; index < previousLength; index++) {
            if (wrote || !Object.prototype.hasOwnProperty.call(array, index)) {
                removedAny = true;
                record(joinPath(basePath, String(index)), array);
            }
        }
    }
    if (removed) {
        for (let i = 0; i < removed.length; i++) {
            const entry = removed[i];
            if (!wrote && Object.prototype.hasOwnProperty.call(array, entry)) continue;
            removedAny = true;
            const key = String(entry);
            record(joinPath(basePath, key), array);
            if (queue) {
                const previous = removedValues?.[i];
                queue({segments: [...basePathSegments, key], previousExists: true,
                    previous: clonePatchValue(previous),
                    nextExists: false, next: undefined});
            }
        }
    }
    if (removedAny) {
        aliases?.checkWrite(array, basePath);
        record(keysPath(basePath), array);
    }
    if (nextLength !== previousLength || writableChanged) {
        aliases?.checkWrite(array, basePath);
        record(joinPath(basePath, 'length'), array);
        if (queue && nextLength !== previousLength) {
            queue({segments: [...basePathSegments, 'length'], previousExists: true,
                previous: previousLength, nextExists: true, next: nextLength});
        }
    }
    if (writableChanged) {
        if (queue) queue(PATCH_ARRAY_LENGTH_LOCK);
        else listener?.(PATCH_ARRAY_LENGTH_LOCK);
    } else if (listener && !concrete && (removedAny || nextLength !== previousLength)) {
        listener(PATCH_OPAQUE);
    }
    if (concrete && patches) deliverPatches(concrete, patches);
    return wrote;
};
