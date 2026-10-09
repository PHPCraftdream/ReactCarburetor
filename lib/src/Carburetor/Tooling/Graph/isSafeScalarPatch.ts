import {IWritePatch} from '@/Carburetor/Models/Paths';

const primitive = (value: unknown): boolean => value === null ||
    (typeof value !== 'object' && typeof value !== 'function');

/** Admits only existing open scalar paths, without traversing sibling native members.
 *
 * @param root - owned baseline to probe.
 * @param patch - candidate scalar operation.
 * @param inverse - checks the undo direction when true.
 */
export const isSafeScalarPatch = (root: unknown, patch: IWritePatch, inverse = false): boolean => {
    const exists = inverse ? patch.previousExists : patch.nextExists;
    const sourceExists = inverse ? patch.nextExists : patch.previousExists;
    const value = inverse ? patch.previous : patch.next;
    const source = inverse ? patch.next : patch.previous;
    if (!exists || !sourceExists || !primitive(value) || !primitive(source) ||
        patch.replacesBranch || patch.segments.length === 0) return false;
    let node = root;
    for (let index = 0; index < patch.segments.length; index++) {
        if (node === null || typeof node !== 'object') return false;
        const prototype = Object.getPrototypeOf(node);
        if (Array.isArray(node)) {
            if (prototype !== Array.prototype ||
                Object.getOwnPropertyDescriptor(node, 'length')?.writable !== true) return false;
        } else if (prototype !== Object.prototype && prototype !== null) return false;
        const field = Object.getOwnPropertyDescriptor(node, patch.segments[index]);
        if (!field || !('value' in field) || !field.enumerable || !field.writable ||
            !field.configurable) return false;
        node = field.value;
    }
    return primitive(node);
};
