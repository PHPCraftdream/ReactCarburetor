/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// `useComputedValue` delivers stable-reference results — a Map mutated in place and a stable
// envelope around it — with one commit and one render per consumer per publication, and the
// hook hands every consumer the same value identity across all publications.
// Args: [consumers=100] [writes=10]
import {emit, load, median, setupReact} from '../../harness/lib.mjs';

const consumers = Number(process.argv[2] ?? 100);
const writes = Number(process.argv[3] ?? 10);
const {Carburetor, computed} = await load();
const {useComputedValue} = await load('Interop');
const {React, flushSync, container} = await setupReact();
const {createRoot} = await import('react-dom/client');
class S extends Carburetor { run(fn) { this.update(fn); } }

const results = {};
for (const kind of ['primitive', 'map', 'envelope']) {
    const store = new S({count: 0, index: new Map([['a', 0]])});
    const envelope = {index: store.getData().index};
    const source = computed(read => {
        const state = read(store);
        if (kind === 'primitive') return state.count;
        if (kind === 'map') return state.index;
        void state.index;
        return envelope;
    });
    let announcements = 0;
    source.subscribe(() => announcements++);
    let renders = 0;
    const identities = new WeakSet();
    let distinctValues = 0;
    const Child = () => {
        renders++;
        const value = useComputedValue(source);
        if (kind !== 'primitive' && !identities.has(value)) {
            identities.add(value);
            distinctValues++;
        }
        const shown = kind === 'primitive' ? value : kind === 'map' ? value.get('a') : value.index.get('a');
        return React.createElement('span', null, shown);
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => root.render(
        Array.from({length: consumers}, (_, key) => React.createElement(Child, {key}))));
    const mounted = {announcements, renders};
    global.gc?.();
    const times = [];
    for (let i = 1; i <= writes; i++) {
        const start = performance.now();
        flushSync(() => store.run(d => { d.count++; d.index.set('a', d.count); }));
        times.push(performance.now() - start);
    }
    results[kind] = {
        ms: median(times),
        announcements: announcements - mounted.announcements,
        renders: renders - mounted.renders,
        text: `${host.childElementCount}:${host.firstChild.textContent}`,
        distinctValues,
    };
    root.unmount();
    host.remove();
}
emit({
    primitiveRenders: results.primitive.renders, primitiveText: results.primitive.text,
    primitiveMs: results.primitive.ms,
    mapAnnouncements: results.map.announcements,
    mapRenders: results.map.renders, mapText: results.map.text, mapMs: results.map.ms,
    mapDistinctValues: results.map.distinctValues,
    envelopeRenders: results.envelope.renders, envelopeText: results.envelope.text,
    envelopeMs: results.envelope.ms,
    envelopeDistinctValues: results.envelope.distinctValues,
});
void container;
