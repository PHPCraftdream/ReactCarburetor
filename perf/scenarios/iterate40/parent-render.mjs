import {emit, load, median, setupReact} from '../../harness/lib.mjs';
import {countHandlers} from './counts.mjs';
import {sameReads} from './sameReads.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
const n = 5000;
class Store extends Carburetor {
    /** Paths captured during reads. */
    reads = new Set();
    /**
     * Publishes a draft mutation.
     *
     * @param fn - Draft mutation.
     */
    change(fn) { this.update(fn); }
    /**
     * Records paths alongside the caller's recorder.
     *
     * @param record - Caller recorder.
     */
    read(record) { return super.read(path => { this.reads.add(path); record(path); }); }
}
const probe = native => {
    const store = new Store({ids: Array.from({length: n}, (_, i) => 'r' + i), other: 0});
    let renders = 0, active, mapGets = 0, mapHas = 0, readMapMs = 0;
    const callback = id => React.createElement('span', {key: id}, id);
    class Parent extends AntiHookComponent {
        /** Renders the tracked list. */
        render() {
            renders++;
            const readMapStart = performance.now();
            const ids = this.useCarburetor(store).ids;
            const beforeGet = active?.get ?? 0, beforeHas = active?.has ?? 0;
            const children = native ? Array.prototype.map.call(ids, callback) : ids.map(callback);
            readMapMs += performance.now() - readMapStart;
            if (active) { mapGets = active.get - beforeGet; mapHas = active.has - beforeHas; }
            return React.createElement('div', null, children);
        }
    }
    let counts, parentCounts, appendCounts;
    let exact, mountReads, mountText, quiet, appendReads, textCorrect, appendRenders;
    countHandlers(counter => {
    active = counter;
    flushSync(() => root.render(React.createElement(Parent, {revision: 0})));
    counts = {get: mapGets, has: mapHas};
    const expected = ['ids.~p', 'ids.length', ...Array.from({length: n}, (_, i) => 'ids.' + i)];
    exact = sameReads(store.reads, expected);
    mountReads = store.reads.size;
    mountText = container.textContent;
    store.reads.clear();
    flushSync(() => root.render(React.createElement(Parent, {revision: 1})));
    parentCounts = {get: mapGets, has: mapHas};
    exact &&= sameReads(store.reads, expected);
    const before = renders;
    flushSync(() => store.change(d => { d.other++; }));
    quiet = renders === before;
    store.reads.clear();
    flushSync(() => store.change(d => { d.ids.push('r5000'); }));
    appendCounts = {get: mapGets, has: mapHas};
    appendReads = store.reads.size;
    exact &&= sameReads(store.reads, [...expected, 'ids.5000']);
    textCorrect = container.textContent === mountText + 'r5000' && container.querySelectorAll('span').length === n + 1;
    appendRenders = renders - before;
    });
    active = undefined;
    flushSync(() => root.render(null));
    const samples = [], readMapSamples = [], restSamples = [];
    const expectedAppendText = Array.from({length: n + 1}, (_, i) => 'r' + i).join('');
    let timingCorrect = true;
    for (let i = 0; i < 13; i++) {
        store.setData({ids: Array.from({length: n}, (_, j) => 'r' + j), other: 0});
        flushSync(() => root.render(React.createElement(Parent)));
        readMapMs = 0;
        const start = performance.now();
        flushSync(() => store.change(d => { d.ids.push('r5000'); }));
        const elapsed = performance.now() - start;
        const parentReadMap = readMapMs;
        timingCorrect &&= container.textContent === expectedAppendText
            && container.querySelectorAll('span').length === n + 1
            && Number.isFinite(parentReadMap) && parentReadMap >= 0 && parentReadMap <= elapsed;
        if (i >= 4) {
            samples.push(elapsed);
            readMapSamples.push(parentReadMap);
            restSamples.push(elapsed - parentReadMap);
        }
        flushSync(() => root.render(null));
    }
    return {gets: counts.get, has: counts.has, parentGets: parentCounts.get, parentHas: parentCounts.has,
        appendGets: appendCounts.get, appendHas: appendCounts.has, mountReads, appendReads,
        exact, quiet, textCorrect, appendRenders, appendMs: median(samples), timingCorrect,
        parentReadMapMs: median(readMapSamples), appendRestMs: median(restSamples)};
};
const fast = probe(false), native = probe(true);
root.unmount();
emit({gets: fast.gets, has: fast.has, parentGets: fast.parentGets, parentHas: fast.parentHas,
    nativeGets: native.gets, nativeHas: native.has, appendGets: fast.appendGets, appendHas: fast.appendHas,
    nativeAppendGets: native.appendGets, nativeAppendHas: native.appendHas,
    readCount: fast.mountReads, appendReadCount: fast.appendReads,
    exactReads: fast.exact && native.exact, appendRenders: fast.appendRenders,
    nativeAppendRenders: native.appendRenders,
    appendMs: fast.appendMs, nativeAppendMs: native.appendMs,
    parentReadMapMs: fast.parentReadMapMs, nativeParentReadMapMs: native.parentReadMapMs,
    appendRestMs: fast.appendRestMs, nativeAppendRestMs: native.appendRestMs,
    timingCorrect: fast.timingCorrect && native.timingCorrect,
    correct: fast.quiet && native.quiet && fast.textCorrect && native.textCorrect
        && fast.timingCorrect && native.timingCorrect});
