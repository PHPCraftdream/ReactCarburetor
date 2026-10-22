import {TPathRecorder} from "../../../Models/Paths";
import {WILDCARD_PATH} from "../../Paths/WildcardPath";
import {isTrackable} from "../isTrackable";
import {nativeAliasIndex} from "./NativeAliasIndex";

/** Cached alias answer owned by one weak root, valid at one index generation. */
interface IAliasAnswer {
    generation: number;
    wildcard: boolean;
    paths: string[];
}

// Root-first ephemeron ownership: a caller-held native must not keep a retired root alive.
// Answers contain only generation/path data, never the root or exposed graph objects.
const answers = new WeakMap<object, WeakMap<object, IAliasAnswer>>();

/** Inspect own data only: never invoke getters, including non-enumerable/symbol fields. */
const hasObjectData = (value: object, keys: readonly (string | symbol)[]): boolean => {
    for (const key of keys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor &&
            descriptor.value !== null && typeof descriptor.value === 'object') return true;
    }
    return false;
};

/** No Sets or per-read closures; the reflection APIs still allocate key arrays. */
const isScalarLeaf = (value: object): boolean =>
    !(value instanceof Map) && !(value instanceof Set) && !isTrackable(value) &&
    !hasObjectData(value, Object.getOwnPropertyNames(value)) &&
    !hasObjectData(value, Object.getOwnPropertySymbols(value));

/**
 * Subscribes to the ordinary aliases a coarse native read exposes, cached per root generation.
 *
 * Root backlinks subscribe to the whole store; primitive reads skip the index. An in-place
 * mutation of the value is picked up only after the next topological write.
 *
 * @param root - current read tree root
 * @param native - exposed raw member or collection
 * @param record - read dependency recorder
 */
export const recordNativeAliasReads = (
    root: object, native: unknown, record: TPathRecorder
): void => {
    if (native === null || typeof native !== 'object') return;
    const generation = nativeAliasIndex.generation(root);
    let rootAnswers = answers.get(root);
    if (rootAnswers === undefined) {
        rootAnswers = new WeakMap<object, IAliasAnswer>();
        answers.set(root, rootAnswers);
    }
    const cached = rootAnswers.get(native);
    if (cached !== undefined && cached.generation === generation) {
        if (cached.wildcard) record(WILDCARD_PATH);
        else for (const path of cached.paths) record(path);
        return;
    }

    // A negative answer is generation-scoped, not permanent: in-place object additions
    // must become visible after topology changes. Dates are not unconditionally leaves.
    if (isScalarLeaf(native)) {
        if (cached !== undefined && !cached.wildcard && cached.paths.length === 0) {
            cached.generation = generation;
        } else {
            rootAnswers.set(native, {generation, wildcard: false, paths: []});
        }
        return;
    }

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
    const wildcard = exposed.has(root);
    const paths: string[] = [];
    if (!wildcard && exposed.size > 0) {
        const index = nativeAliasIndex.paths(root);
        for (const value of exposed) {
            const aliases = index.get(value);
            if (aliases !== undefined) paths.push(...aliases);
        }
    }
    rootAnswers.set(native, {generation, wildcard, paths});
    if (wildcard) record(WILDCARD_PATH);
    else for (const path of paths) record(path);
};
