import {hasRepeatedContainer} from './hasRepeatedContainer';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {sameKind} from './sameKind';

/** R39-05: a changed array with repeated containers requires whole-graph restore.
 *
 * @param previous - Current graph.
 * @param next - Restore endpoint. */
export const requiresArrayGraphRestore = (previous: unknown, next: unknown): boolean => {
    const visited = new WeakMap<object, WeakSet<object>>();
    const visit = (old: unknown, value: unknown): boolean => {
        if (Object.is(old, value) || !isTrackable(old) || !isTrackable(value) || !sameKind(old, value)) return false;
        const partners = visited.get(old);
        if (partners?.has(value)) return false;
        if (partners) partners.add(value);
        else visited.set(old, new WeakSet([value]));
        if (Array.isArray(old)) return hasRepeatedContainer(old) || hasRepeatedContainer(value);
        for (const key of Object.keys(value)) {
            if (visit((old as Record<string, unknown>)[key], (value as Record<string, unknown>)[key])) return true;
        }
        return false;
    };
    return visit(previous, next);
};
