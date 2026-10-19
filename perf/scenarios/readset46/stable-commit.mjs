/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
// A class list parent re-rendering with an unchanged read set: render and commit construct no Set,
// slice nothing, and neither subscribe nor re-file. A branch switch still builds and re-files the
// new set. Counted per mode (useCarburetor, connect) over stable rounds. Args: [rows=1000] [rounds=5]
import {emit, engineKey, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();

const rows = Number(process.argv[2] ?? 1000);
const rounds = Number(process.argv[3] ?? 5);
const NativeSet = globalThis.Set;
const rawSlice = String.prototype.slice;
const counters = {sets: 0, slices: 0};

const CountingSet = class extends NativeSet {
    constructor(...args) { super(...args); counters.sets++; }
};
const countingSlice = function (...args) { counters.slices++; return rawSlice.apply(this, args); };
const begin = on => {
    if (!on) return;
    globalThis.Set = CountingSet;
    String.prototype.slice = countingSlice;
};
const end = () => {
    globalThis.Set = NativeSet;
    String.prototype.slice = rawSlice;
};

class ListStore extends Carburetor {
    subscribes = 0;
    refiles = 0;
    constructor(data) {
        super(data);
        const index = this[engineKey('subscriberIndex', this)];
        const add = index.add;
        index.add = (...args) => { this.refiles++; return add.apply(index, args); };
    }
    subscribe(callback, options) { this.subscribes++; return super.subscribe(callback, options); }
    run(mutate) { this.update(mutate); }
}

const runMode = mode => {
    const store = new ListStore({
        items: Array.from({length: rows}, (_, id) => ({id, title: 't' + id, owner: {name: 'n' + id}})),
        titles: true,
    });
    let renders = 0;
    let counting = false;

    class List extends AntiHookComponent {
        data = this.connect(() => store);

        render() {
            renders++;
            begin(counting);
            try {
                const {items, titles} = mode === 'track' ? this.useCarburetor(store) : this.data;
                return React.createElement('ul', null, items.map(row => React.createElement('li', {key: row.id},
                    (titles ? row.title : '') + row.owner.name)));
            } finally { end(); }
        }

        componentDidUpdate(prevProps) {
            begin(counting);
            try { super.componentDidUpdate(prevProps); } finally { end(); }
        }
    }

    flushSync(() => root.render(React.createElement(List)));
    // The first update learns the raw recording; the second already reuses it.
    for (let k = 0; k < 2; k++) flushSync(() => store.run(draft => { draft.items[1].title = 'warm' + k; }));

    const before = {subscribes: store.subscribes, refiles: store.refiles};
    counters.sets = counters.slices = 0;
    counting = true;
    for (let k = 0; k < rounds; k++) flushSync(() => store.run(draft => { draft.items[5].title = 'x' + k; }));
    counting = false;
    const stable = {
        sets: counters.sets, slices: counters.slices,
        subscribes: store.subscribes - before.subscribes, refiles: store.refiles - before.refiles,
    };
    const stableCorrect = renders === rounds + 3
        && container.querySelectorAll('li')[5].textContent === 'x' + (rounds - 1) + 'n5';

    // Positive control: a branch switch constructs the new set and re-files it once.
    const switchBefore = {subscribes: store.subscribes, refiles: store.refiles};
    counters.sets = counters.slices = 0;
    counting = true;
    flushSync(() => store.run(draft => { draft.titles = false; }));
    counting = false;
    const switched = {
        sets: counters.sets,
        subscribes: store.subscribes - switchBefore.subscribes, refiles: store.refiles - switchBefore.refiles,
    };
    const quiet = renders;
    flushSync(() => store.run(draft => { draft.items[3].title = 'quiet'; }));
    flushSync(() => store.run(draft => { draft.items[3].owner.name = 'loud'; }));
    const switchCorrect = renders === quiet + 1 && container.querySelectorAll('li')[3].textContent === 'loud';

    flushSync(() => root.render(null));
    return {stable, switched, correct: stableCorrect && switchCorrect};
};

const track = runMode('track');
const connect = runMode('connect');
flushSync(() => root.unmount());

emit({
    rows, rounds,
    trackSets: track.stable.sets, trackSlices: track.stable.slices,
    trackSubscribes: track.stable.subscribes, trackRefiles: track.stable.refiles,
    connectSets: connect.stable.sets, connectSlices: connect.stable.slices,
    connectSubscribes: connect.stable.subscribes, connectRefiles: connect.stable.refiles,
    switchSets: Math.min(track.switched.sets, connect.switched.sets),
    switchSubscribes: track.switched.subscribes + connect.switched.subscribes,
    switchRefiles: track.switched.refiles + connect.switched.refiles,
    correct: track.correct && connect.correct,
});
