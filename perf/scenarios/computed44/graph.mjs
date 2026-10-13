import {engine} from '../../harness/lib.mjs';

/** Public repeated-flat graph plus read-only complete checkpoint diagnostics.
 *
 * @param libraries - Selected primary and peer distribution APIs.
 * @param K - Number of input projections.
 * @param M - Number of independent leaf stores.
 * @param layout - Input topology under measurement.
 * @param instrumented - Collect mechanism counters/events (disabled for timing).
 */
export const graph = (libraries, K, M, layout = 'aliases', instrumented = true) => {
    const {primary, peer} = libraries;
    const {Carburetor, computed} = primary;
    const sources = Array.from({length: M}, (_, i) => new Carburetor({n: i + 1, noise: 0}));
    const tick = new Carburetor({n: 0});
    const runs = {group: 0, aliases: Array(K).fill(0), top: 0};
    const events = [];
    const track = (body, count) => instrumented ? read => { count(); return body(read); } : body;
    const group = computed(track(read =>
        sources.reduce((sum, source) => sum + read(source).n, 0), () => { runs.group++; }));
    const groupId = group.subscribe(() => {});
    let externalValue = 0, externalVersion = 0;
    const external = {get: () => externalValue, getUID: () => 'r44-external',
        getVersion: () => externalVersion, subscribe: () => 'external', unsubscribe: () => {}};
    const aliases = layout === 'direct' ? [] : Array.from({length: K}, (_, i) => peer.computed(track(read =>
        (layout === 'distinct' ? sources.reduce((sum, source) => sum + read(source).n, 0)
            : read(group)) + i, () => { runs.aliases[i]++; })));
    const inputs = aliases.length ? aliases : [group];
    const top = computed(track(read => {
        let sum = read(tick).n;
        for (let i = 0; i < K; i++) sum += aliases.length ? read(aliases[i]) : read(group) + i;
        if (layout === 'external') sum += read(external);
        return sum;
    }, () => { runs.top++; }));
    const id = top.subscribe(instrumented ? () => events.push(top.get()) : () => {});
    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
    const snapshots = [group, ...aliases, top].map(value => engine(value, 'versions'));
    const saved = new Map();
    const remember = object => {
        if (!object || typeof object !== 'object' || saved.has(object)) return;
        if (sources.includes(object) || object === tick || object === external) return;
        if (object instanceof Set) {
            saved.set(object, {set: Array.from(object)});
            return;
        }
        const fields = Reflect.ownKeys(object).map(key => [key, Object.getOwnPropertyDescriptor(object, key)]);
        saved.set(object, {fields});
        // Native data is a borrowed identity, not captured metadata.
        for (const [key, descriptor] of fields) if (key !== 'source' && key !== 'data') remember(descriptor.value);
    };
    snapshots.forEach(remember);
    const intact = () => Array.from(saved).every(([object, state]) => {
        if (state.set) return JSON.stringify(Array.from(object)) === JSON.stringify(state.set);
        const keys = Reflect.ownKeys(object);
        return keys.length === state.fields.length && state.fields.every(([key, descriptor], i) => {
            const current = Object.getOwnPropertyDescriptor(object, key);
            return keys[i] === key && current
                && Reflect.ownKeys(descriptor).every(field => current[field] === descriptor[field]);
        });
    });
    const coverage = () => inputs.every(input => Object.values(engine(input, 'versions')).every(record => {
        const output = Object.values(engine(top, 'versions')).find(item => item.source === record.source);
        return output && (record.parts ?? [record]).every(pair => (output.parts ?? [output])
            .some(item => item.version === pair.version && item.reads === pair.reads));
    }));
    return {sources, tick, runs, events, inputs, top, initial, intact, coverage,
        bump: () => { tick.update(draft => { draft.n++; }); return top.get(); },
        silent: () => { externalValue++; externalVersion++; return top.get(); },
        close: () => { top.unsubscribe(id); group.unsubscribe(groupId); }};
};
