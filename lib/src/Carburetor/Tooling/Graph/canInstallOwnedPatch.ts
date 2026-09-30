import {IWritePatch} from '@/Carburetor/Models/Paths';
import {installPatch} from '@/Carburetor/Store/Paths/Diff/installPatch';
import {ownHistoryGraph} from './ownHistoryGraph';

const arrayIndex = (key: string): number | undefined => {
    if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
    const index = Number(key);
    return index < 4294967295 ? index : undefined;
};

/** Check the operation installPatch actually performs, without writing to a held history endpoint. */
const canInstallOwnedPatch = (root: object, patch: IWritePatch): boolean => {
    let node: object = root;
    const {segments} = patch;
    if (segments.length === 0) return false;
    for (let i = 0; i < segments.length - 1; i++) {
        const field = Object.getOwnPropertyDescriptor(node, segments[i]);
        if (!field || !('value' in field) || field.value === null ||
            typeof field.value !== 'object') return false;
        node = field.value;
    }

    const key = segments[segments.length - 1];
    const field = Object.getOwnPropertyDescriptor(node, key);
    if (!patch.nextExists) return field === undefined || field.configurable === true;
    if (key === '__proto__') {
        // installPatch defines this key, rather than invoking Object.prototype's setter.
        return field === undefined ? Object.isExtensible(node) : field.configurable === true;
    }
    if (field?.writable === false || (field === undefined && !Object.isExtensible(node))) return false;
    if (Array.isArray(node)) {
        const length = node.length;
        const lengthField = Object.getOwnPropertyDescriptor(node, 'length');
        if (key === 'length') {
            if (lengthField?.writable === false) return false;
            const next = Number(patch.next);
            if (!Number.isInteger(next) || next < 0 || next > 4294967295) return false;
            if (next < length) {
                for (const member of Reflect.ownKeys(node)) {
                    if (typeof member !== 'string') continue;
                    const index = arrayIndex(member);
                    if (index !== undefined && index >= next && index < length &&
                        Object.getOwnPropertyDescriptor(node, member)?.configurable === false) return false;
                }
            }
        } else {
            const index = arrayIndex(key);
            if (index !== undefined && index >= length && lengthField?.writable === false) return false;
        }
    }
    return true;
};

interface IPathNode {
    terminal: boolean;
    children: Map<string, IPathNode>;
}

/**
 * Independently addressable patches probe the held baseline without cloning it. For overlapping
 * paths, replay on a private copy first so later patches see earlier replacements and no held
 * snapshot can be partially changed by a failed admission.
 *
 * @param root - the held owned baseline.
 * @param patches - ordered operations being admitted.
 */
export const preflightOwnedPatches = (
    root: object, patches: readonly IWritePatch[]
): object | false | undefined => {
    let dependent = false;
    let primitiveOnly = true;
    for (const patch of patches) {
        if ((patch.previous !== null && typeof patch.previous === 'object') ||
            (patch.next !== null && typeof patch.next === 'object')) {
            primitiveOnly = false;
            break;
        }
    }
    if (patches.length > 1 && !primitiveOnly) {
        const tree: IPathNode = {terminal: false, children: new Map()};
        for (const patch of patches) {
            let node = tree;
            for (const segment of patch.segments) {
                if (node.terminal) dependent = true;
                let child = node.children.get(segment);
                if (!child) {
                    child = {terminal: false, children: new Map()};
                    node.children.set(segment, child);
                }
                node = child;
            }
            if (node.terminal || node.children.size > 0) dependent = true;
            node.terminal = true;
            if (dependent) break;
        }
    }
    const preview = dependent ? ownHistoryGraph(root) : undefined;
    for (const patch of patches) {
        if (!canInstallOwnedPatch(preview ?? root, patch)) return false;
        if (preview) installPatch(preview as Record<string, unknown>, patch, false);
    }
    return preview;
};
