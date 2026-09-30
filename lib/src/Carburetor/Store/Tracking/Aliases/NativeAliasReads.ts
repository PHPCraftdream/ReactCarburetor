import {TPathRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * Subscribes to writable plain aliases exposed by a coarse native read, without wrapping entries.
 *
 * Root backlinks subscribe to the whole store.
 *
 * @param root - the current read tree root.
 * @param native - the exposed raw member or collection.
 * @param record - the read dependency recorder.
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

    // Do not globally mark plain nodes visited: two own paths to the same raw object are both
    // valid write paths. The active ancestors guard malformed plain cycles in production.
    const ancestors = new Set<object>();
    const walk = (value: object, path: string): void => {
        if (exposed.has(value)) record(path);
        if (ancestors.has(value)) return;
        ancestors.add(value);
        for (const key of Object.keys(value)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
            const child = descriptor?.value;
            if (isTrackable(child)) walk(child, joinPath(path, key));
        }
        ancestors.delete(value);
    };
    walk(root, '');
};
