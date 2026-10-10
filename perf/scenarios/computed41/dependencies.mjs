import {emit, load, engineKey} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const D = Number(process.argv[2] ?? 500);
const flag = new Carburetor({right: false, tick: 0});
const sources = Array.from({length: D}, () => new Carburetor({left: 1, right: 2}));
let attaches = 0;
let releases = 0;
for (const source of [flag, ...sources]) {
    const subscribe = source.subscribe.bind(source);
    const unsubscribe = source.unsubscribe.bind(source);
    source.subscribe = (...args) => { attaches++; return subscribe(...args); };
    source.unsubscribe = (...args) => { releases++; return unsubscribe(...args); };
}
const result = computed(read => {
    const control = read(flag);
    const right = control.right;
    void control.tick;
    return sources.reduce((sum, source) => sum + (right ? read(source).right : read(source).left), 0);
});
let deliveries = 0;
const id = result.subscribe(() => { deliveries++; });
const initial = result.get();
const diffKey = engineKey('diffDependencies', result);
const originalDiff = result[diffKey];
const originalIncludes = Array.prototype.includes;
let fresh;
let comparisons = 0;
let edgeWork = 0;
result[diffKey] = function(collected) {
    edgeWork += Object.keys(collected).length;
    fresh = originalDiff.call(this, collected);
    return fresh;
};
Array.prototype.includes = function(value, from = 0) {
    if (this !== fresh) return originalIncludes.call(this, value, from);
    for (let i = from; i < this.length; i++) {
        comparisons++;
        if (this[i] === value) return true;
    }
    return false;
};
const values = [];
let retainedAttaches;
let retainedReleases;
try {
    for (let i = 0; i < 7; i++) {
        flag.update(draft => { draft.right = !draft.right; });
        values.push(result.get());
    }
    const beforeAttach = attaches;
    const beforeRelease = releases;
    flag.update(draft => { draft.tick++; });
    retainedAttaches = attaches - beforeAttach;
    retainedReleases = releases - beforeRelease;
} finally {
    Array.prototype.includes = originalIncludes;
    result[diffKey] = originalDiff;
    result.unsubscribe(id);
}
emit({D, initial, values: values.join(','), deliveries, comparisons, edgeWork,
    work: edgeWork + comparisons, retainedAttaches, retainedReleases, done: true});
