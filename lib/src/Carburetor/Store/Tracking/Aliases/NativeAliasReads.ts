import {TPathRecorder} from "@/Carburetor/Models/Paths";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {nativeAliasIndex} from "./NativeAliasIndex";

/**
 * Subscribes to writable ordinary aliases exposed by a coarse native read without wrapping
 * entries. Root backlinks subscribe to the whole store. Primitive reads skip the index.
 *
 * @param root - current read tree root
 * @param native - exposed raw member or collection
 * @param record - read dependency recorder
 */
export const recordNativeAliasReads = (
    root: object, native: unknown, record: TPathRecorder
): void => {
    if (native === null || typeof native !== 'object') return;
    const exposed = new Set<object>();
    const visited = new Set<object>();
    const visit = (value: unknown): void => {
        if (value === null || typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);

        if (isTrackable(value)) exposed.add(value);

        if (value instanceof Map) {
            Map.prototype.forEach.call(value, (member: unknown, key: unknown) => {
                visit(key);
                visit(member);
            });
        } else if (value instanceof Set) {
            Set.prototype.forEach.call(value, (member: unknown) => visit(member));
        }

        // Reflect on own data, not accessors or inherited fields. Native own symbol fields may
        // themselves link to an ordinary plain branch even though symbol paths are not tracked.
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) visit(descriptor.value);
        }
    };
    visit(native);
    if (exposed.size === 0) return;
    if (exposed.has(root)) {
        record(WILDCARD_PATH);
        return;
    }

    const paths = nativeAliasIndex.paths(root);
    for (const value of exposed) {
        const aliases = paths.get(value);
        if (aliases !== undefined) {
            for (const path of aliases) record(path);
        }
    }
};
