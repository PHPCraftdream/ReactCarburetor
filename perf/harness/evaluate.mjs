/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Gate evaluation. A gate is one assertion over a summarized scenario run:
//   {metric, equals}              every sample equals the value (counters, rendered text, booleans)
//   {metric, max} / {metric, min} the median stays within an absolute bound
//   {metric, over, max}           median(metric) / median(over) <= max, both from the same run
//                                 (machine-independent: restore against snapshot, toJSON against dehydrate)
//   {metric, scale: {from}, max}  median(metric) / median(from.metric of another entry) <= max
//                                 (machine-independent: cost at 50k rows against 10k rows)

/**
 * Evaluates one entry's gates.
 *
 * @param entry - the manifest entry
 * @param summary - summarize() of this entry's samples
 * @param summaries - Map id -> summary of every entry measured so far (for scale gates)
 * @returns array of {ok, label, detail}
 */
export const evaluate = (entry, summary, summaries) => entry.gates.map(gate => {
    const item = summary[gate.metric];
    const label = `${entry.id} ${gate.metric}`;
    if (item === undefined) return {ok: false, label, detail: 'metric missing from the scenario output'};

    if ('equals' in gate) {
        const ok = item.values.every(value => value === gate.equals);
        return {ok, label, detail: `${item.values.join(',')} == ${JSON.stringify(gate.equals)}`};
    }
    if (typeof item.median !== 'number') {
        return {ok: false, label, detail: 'metric is not a number: ' + item.values.join(',')};
    }
    if ('over' in gate) {
        const other = summary[gate.over];
        if (typeof other?.median !== 'number') return {ok: false, label, detail: `${gate.over} is not a number`};
        const ratio = item.median / other.median;
        return {ok: ratio <= gate.max, label: `${label}/${gate.over}`, detail: `${ratio.toFixed(2)} <= ${gate.max}`};
    }
    if (gate.scale) {
        const from = summaries.get(gate.scale.from)?.[gate.metric];
        if (from === undefined) return {ok: false, label, detail: `entry ${gate.scale.from} was not measured`};
        const ratio = item.median / from.median;
        return {
            ok: ratio <= gate.max, label: `${label} vs ${gate.scale.from}`,
            detail: `${ratio.toFixed(2)}x <= ${gate.max}x`,
        };
    }
    if ('max' in gate) {
        return {ok: item.median <= gate.max, label, detail: `${item.median.toFixed(4)} <= ${gate.max}`};
    }

    return {ok: item.median >= gate.min, label, detail: `${item.median.toFixed(4)} >= ${gate.min}`};
});

/**
 * Compares a build against a baseline build on every numeric timing metric (names ending in Ms).
 * A slowdown beyond 25% and beyond a small absolute noise floor is a regression.
 *
 * @param entry - the manifest entry (unused beyond its id)
 * @param current - summary of the build under test
 * @param base - summary of the baseline build
 * @returns array of {ok, label, detail}
 */
export const compare = (entry, current, base) => Object.keys(current)
    .filter(metric => metric.endsWith('Ms') && typeof current[metric].median === 'number'
        && typeof base[metric]?.median === 'number')
    .map(metric => {
        const now = current[metric].median;
        const was = base[metric].median;
        const ok = !(now > was * 1.25 && now - was > 0.05);
        return {
            ok, label: `${entry.id} ${metric}`,
            detail: `${was.toFixed(4)} -> ${now.toFixed(4)} (${(now / was).toFixed(2)}x)`,
        };
    });
