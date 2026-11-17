import {appendFileSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const phaseBudget = phase => ({
    combined: 5 * 60_000,
    ci: 5 * 60_000,
    focused: 60_000,
})[phase] ?? 5 * 60_000;
// Scenarios whose verdict depends on garbage collection or heap state are not deterministic counters.
const GC_SENSITIVE = /\bWeakRef\b|FinalizationRegistry|memoryUsage|heapUsed|getHeapStatistics|expose-gc|\bgc\s*\(/;
const IMPORT = /(?:\bfrom|\bimport\s*\(?)\s*['"](\.[^'"]+)['"]/g;
const readScenario = path => {
    try { return readFileSync(path, 'utf8'); } catch { return undefined; }
};
const gcSensitive = (path, read, seen = new Set()) => {
    if (seen.has(path)) return false;
    seen.add(path);
    const source = read(path);
    if (source === undefined || GC_SENSITIVE.test(source)) return true;
    return [...source.matchAll(IMPORT)].some(match => gcSensitive(resolve(dirname(path), match[1]), read, seen));
};
const classifySampling = (entry, read = readScenario) => {
    if (typeof entry.scenario !== 'string') return 'mixed';
    if (entry.nodeArgs?.some(arg => /expose-gc/.test(String(arg)))) return 'mixed';
    if (gcSensitive(resolve('perf/scenarios', entry.scenario + '.mjs'), read)) return 'mixed';
    const gates = entry.gates;
    if (!Array.isArray(gates) || gates.length === 0) return 'mixed';
    return gates.every(gate => {
        if (
            !gate || typeof gate !== 'object' || typeof gate.metric !== 'string' || gate.metric.length === 0
        ) return false;
        const kinds = ['equals', 'max', 'min', 'over', 'scale'].filter(kind => Object.hasOwn(gate, kind));
        if (kinds.length !== 1 || kinds[0] === 'over' || kinds[0] === 'scale') return false;
        return !gate.metric.endsWith('Ms') && !/(?:byte|kb|mb)/i.test(gate.metric);
    }) ? 'counter' : 'mixed';
};
const keyFor = entry => JSON.stringify([entry.scenario, entry.args ?? [], entry.nodeArgs ?? []]);
/**
 * The sample keys whose children may run side by side: no entry measured from them has a verdict
 * that depends on wall-clock time. Timing is what the `Ms` suffix names (as `compare` reads it), so
 * an entry is timed when a gate reads an `...Ms` metric, directly or through `over`, when a scale
 * gate compares it with another entry, or when it is that other entry; an entry without gates is
 * treated as timed. A scenario that depends on garbage collection (the GC-sensitive reading of
 * `classifySampling`) also runs alone: whether a weak reference is collected in time can depend on
 * the CPU the neighbours take. Counters and heap figures stay each child's own under load.
 */
const concurrentKeys = (entries, read = readScenario) => {
    const timedIds = new Set();
    for (const entry of entries) {
        const gates = Array.isArray(entry.gates) ? entry.gates : [];
        if (gates.length === 0 || typeof entry.scenario !== 'string'
            || entry.nodeArgs?.some(arg => /expose-gc/.test(String(arg)))
            || gcSensitive(resolve('perf/scenarios', entry.scenario + '.mjs'), read)) timedIds.add(entry.id);
        for (const gate of gates) {
            if (!gate || typeof gate.metric !== 'string' || gate.metric.endsWith('Ms')
                || (typeof gate.over === 'string' && gate.over.endsWith('Ms'))) timedIds.add(entry.id);
            if (gate?.scale) {
                timedIds.add(entry.id);
                timedIds.add(gate.scale.from);
            }
        }
    }
    const timedKeys = new Set(entries.filter(entry => timedIds.has(entry.id)).map(keyFor));
    return new Set(entries.map(keyFor).filter(key => !timedKeys.has(key)));
};
const demandByKey = (entries, counterRuns = 1, timingRuns = 3, read = readScenario) => {
    for (const [name, count] of [['counterRuns', counterRuns], ['timingRuns', timingRuns]]) {
        if (!Number.isInteger(count) || count <= 0) throw new TypeError(`${name} must be a positive integer`);
    }
    for (const entry of entries) {
        if (entry.runs !== undefined && (!Number.isInteger(entry.runs) || entry.runs <= 0)) {
            throw new TypeError('entry.runs must be a positive integer');
        }
    }
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const demands = new Map();
    const demand = (entry, count, seen = new Set()) => {
        if (!entry || seen.has(entry.id)) return;
        seen.add(entry.id);
        const key = keyFor(entry);
        demands.set(key, Math.max(demands.get(key) ?? 0, count));
        for (const gate of entry.gates ?? []) if (gate.scale) demand(byId.get(gate.scale.from), count, seen);
    };
    for (const entry of entries) {
        const count = classifySampling(entry, read) === 'counter'
            ? counterRuns
            : Math.max(3, timingRuns, entry.runs ?? 0);
        demand(entry, count);
    }
    return demands;
};
const elapsedRow = (entry, elapsedMs, error) => ({...entry, elapsedMs, ...(error ? {error: error.message} : {})});
const timingSummary = (title, rows, sink) => {
    const lines = [...rows].sort((a, b) => (b.elapsedMs ?? -1) - (a.elapsedMs ?? -1)).slice(0, 20)
        .map(row => `| ${row.id} | ${row.elapsedMs ?? '—'}ms | ${row.error ?? ''} |`);
    const text = `\n### ${title}\n\n| Entry | Elapsed | Error |\n|---|---:|---|\n${lines.join('\n')}\n`;
    if (sink) sink(text);
    else if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
};
/** `--shard i/n`: the 1-based index and the count, validated. */
const parseShard = text => {
    const match = /^(\d+)\/(\d+)$/.exec(String(text));
    const index = Number(match?.[1]), count = Number(match?.[2]);
    if (!match || count < 1 || index < 1 || index > count) {
        throw new Error(`--shard expects i/n with 1 <= i <= n, got ${text}`);
    }
    return {index, count};
};

/**
 * The ids of shard `index` (1-based) of `count` shards of about equal cost. Entries that share a
 * sample key or that a scale gate ties together form one group, and each group goes whole to the
 * lightest shard so far, heaviest group first, so every shard measures what its gates compare.
 * `weights` maps an entry id to its last serial cost in ms (perf/shards.json); an unknown entry
 * that owns its key costs the median, and a key that runs side by side costs a third.
 */
const shardOf = (entries, index, count, weights = {}, read = readScenario) => {
    const parent = new Map(entries.map(entry => [entry.id, entry.id]));
    const find = id => {
        while (parent.get(id) !== id) id = parent.get(id);
        return id;
    };
    const union = (a, b) => {
        if (parent.has(a) && parent.has(b) && find(a) !== find(b)) parent.set(find(a), find(b));
    };
    const owners = new Map();
    for (const entry of entries) {
        const key = keyFor(entry);
        if (owners.has(key)) union(entry.id, owners.get(key));
        else owners.set(key, entry.id);
        for (const gate of entry.gates ?? []) if (gate?.scale) union(entry.id, gate.scale.from);
    }
    const known = Object.values(weights).filter(cost => cost > 0).sort((a, b) => a - b);
    const median = known.length ? known[known.length >> 1] : 1;
    const concurrent = concurrentKeys(entries, read);
    const groups = new Map();
    for (const entry of entries) {
        const root = find(entry.id);
        const group = groups.get(root) ?? {ids: [], cost: 0, name: entry.id};
        const key = keyFor(entry);
        const cost = weights[entry.id] ?? (owners.get(key) === entry.id ? median : 0);
        group.ids.push(entry.id);
        group.cost += concurrent.has(key) ? cost / 3 : cost;
        if (entry.id < group.name) group.name = entry.id;
        groups.set(root, group);
    }
    const loads = Array.from({length: count}, () => 0);
    const picked = new Set();
    const ordered = [...groups.values()].sort((a, b) => b.cost - a.cost || (a.name < b.name ? -1 : 1));
    for (const group of ordered) {
        let target = 0;
        for (let shard = 1; shard < count; shard++) if (loads[shard] < loads[target]) target = shard;
        loads[target] += group.cost;
        if (target === index - 1) group.ids.forEach(id => picked.add(id));
    }
    return picked;
};

/** The per-phase entry costs perf/shards.json records. */
const shardWeights = phase => {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'shards.json');
    return JSON.parse(readFileSync(path, 'utf8'))[phase] ?? {};
};

export default {phaseBudget, classifySampling, demandByKey, elapsedRow, timingSummary, keyFor, concurrentKeys,
    parseShard, shardOf, shardWeights};
