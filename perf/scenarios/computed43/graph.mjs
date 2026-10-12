import {load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
export const sizes = [[1, 4], [1, 16], [1, 64], [4, 4], [4, 16], [4, 64],
    [16, 4], [16, 16], [16, 64], [64, 4], [64, 16], [64, 64], [8, 8]];
/** Parses and validates the graph dimensions and layout from command-line arguments.
 *
 * @returns The supported alias count, leaf count and layout.
 */
export const argumentsForGraph = () => {
    const K = Number(process.argv[2]);
    const M = Number(process.argv[3]);
    const layout = process.argv[4];
    if (!sizes.some(pair => pair[0] === K && pair[1] === M)
        || !['bare-first', 'merged-first', 'distinct'].includes(layout)) throw new Error('invalid graph arguments');
    return {K, M, layout};
};
/** Creates an observed fan-in graph with shared leaf metadata and operation counters.
 *
 * @param K - Number of aliases reading the shared group.
 * @param M - Number of native store leaves in the shared group.
 * @param layout - Extra-leaf placement or distinct-store control.
 * @returns The graph sources, counters, write operation and subscription cleanup.
 */
export const graph = (K, M, layout) => {
    const store = new Carburetor({extra: 0, noise: 0,
        ...Object.fromEntries(Array.from({length: M}, (_, i) => ['p' + i, i + 1]))});
    const extra = layout === 'distinct' ? new Carburetor({extra: 0}) : store;
    const leafRuns = Array(M).fill(0);
    const leaves = Array.from({length: M}, (_, i) => computed(read => {
        leafRuns[i]++;
        return read(store)['p' + i];
    }));
    let groupRuns = 0;
    let topRuns = 0;
    const group = computed(read => {
        groupRuns++;
        return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
    });
    const groupId = group.subscribe(() => {});
    const aliasRuns = Array(K).fill(0);
    const aliases = Array.from({length: K}, (_, i) => computed(read => {
        aliasRuns[i]++;
        return read(group) + i;
    }));
    const top = computed(read => {
        topRuns++;
        let e = layout === 'merged-first' ? 0 : read(extra).extra;
        const sum = aliases.reduce((total, alias) => total + read(alias), 0);
        if (layout === 'merged-first') e = read(extra).extra;
        return sum + e;
    });
    const events = [];
    const topId = top.subscribe(() => events.push(top.get()));
    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
    return {K, M, layout, store, extra, leaves, group, aliases, top, events, initial,
        bump() { extra.update(draft => { draft.extra++; }); return top.get(); },
        counts: () => ({groupRuns, topRuns, aliasRuns: aliasRuns.slice(), leafRuns: leafRuns.slice()}),
        close() { top.unsubscribe(topId); group.unsubscribe(groupId); }};
};
