import {appendFileSync} from 'node:fs';
const phaseBudget = phase => ({
    combined: 40 * 60_000,
    ci: 5 * 60_000,
    focused: 60_000,
})[phase] ?? 5 * 60_000;
const classifySampling = entry => {
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
const demandByKey = (entries, counterRuns = 1, timingRuns = 3) => {
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
        const count = classifySampling(entry) === 'counter'
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
export default {phaseBudget, classifySampling, demandByKey, elapsedRow, timingSummary, keyFor};
