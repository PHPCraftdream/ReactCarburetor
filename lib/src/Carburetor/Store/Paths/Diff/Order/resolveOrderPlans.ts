import {IWritePatch} from "@/Carburetor/Models/Paths";
import {isOrderedStringKey} from "./isOrderedStringKey";

/** Collision-free identity of a patch's container path, for one entry's plan cache. */
const containerKey = (segments: readonly string[]): string => {
    let joined = '';
    for (const segment of segments) {
        if (joined !== '') joined += '|';
        joined += segment.length + ':' + segment;
    }
    return joined;
};

    /**
     * Attaches each deletion's undo order plan, derived once per container from the baseline.
     *
     * Plans land on private copies: the pending patch objects are shared with every other
     * observer. Undefined means an order the plans cannot reinstate exactly, so the
     * publication falls back to a full snapshot.
     *
     * @param baseline - the publication baseline the deleted keys are looked up in.
     * @param pending - the collected patches; deletions get their plans.
     */
export const resolveOrderPlans = (baseline: unknown, pending: IWritePatch[]): IWritePatch[] | undefined => {
        let resolved: IWritePatch[] | undefined;
        const containers = new Map<string, {positions: Map<string, number>; keys: string[];
            lastOrdered: number; lastBlocking: number; container: Record<string, unknown>}>();
        for (let index = 0; index < pending.length; index++) {
            const patch = pending[index];
            if (patch.previousExists === false || patch.nextExists ||
                patch.segments.length === 0) continue;
            const key = patch.segments[patch.segments.length - 1];
            if (!isOrderedStringKey(key)) continue;
            const containerSegments = patch.segments.slice(0, -1);
            let node: unknown = baseline;
            let resolvedContainer = true;
            for (const segment of containerSegments) {
                if (node === null || typeof node !== 'object') { resolvedContainer = false; break; }
                const field = Object.getOwnPropertyDescriptor(node, segment);
                if (field === undefined || !('value' in field)) { resolvedContainer = false; break; }
                node = field.value;
            }
            if (!resolvedContainer || node === null || typeof node !== 'object') return undefined;
            const container = node as Record<string, unknown>;
            const joined = containerKey(containerSegments);
            let entry = containers.get(joined);
            if (entry === undefined) {
                const keys = Object.keys(container);
                const positions = new Map<string, number>();
                let lastOrdered = -1;
                // The last ordered key undo could not re-append after: it must not be deleted before it.
                let lastBlocking = -1;
                for (let i = keys.length - 1; i >= 0; i--) {
                    positions.set(keys[i], i);
                    if (!isOrderedStringKey(keys[i])) continue;
                    if (lastOrdered < 0) lastOrdered = i;
                    if (lastBlocking < 0) {
                        const field = Object.getOwnPropertyDescriptor(container, keys[i]);
                        if (field === undefined || !field.configurable) lastBlocking = i;
                    }
                }
                entry = {positions, keys, lastOrdered, lastBlocking, container};
                containers.set(joined, entry);
            }
            const position = entry.positions.get(key);
            if (position === undefined) return undefined;
            if (position >= entry.lastOrdered) continue;
            if (entry.lastBlocking > position) return undefined;
            (resolved ??= pending.slice())[index] =
                {...patch, orderPlan: {keys: entry.keys, from: position + 1}};
        }
    return resolved ?? pending;
};


