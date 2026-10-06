/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-01: a watch over rows aliased through a native Map must keep snapshot.link.get('row') === snapshot.rows[1]
// with the linked value updated on the first AND the second edit; the plain-list control keeps publishing.
// Args: [edits=2]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();

const edits = Number(process.argv[2] ?? 2);
const makeRows = shared => {
    const rows = [{id: 'a', n: 1, link: null}, {id: 'b', n: 1, link: null}];
    if (shared) rows[0].link = new Map([['row', rows[1]]]);
    return rows;
};

// Shared graph: alias identity plus the linked value after every edit, held snapshots untouched.
const sharedStore = new Carburetor({rows: makeRows(true), other: 0});
const sharedWakes = [];
const stopShared = sharedStore.watch(d => d.rows, (next, previous) => { sharedWakes.push({next, previous}); });
sharedStore.update(d => { d.rows[1].n = 2; });
sharedStore.update(d => { d.rows[1].n = 3; });
stopShared();

let aliasBothEdits = sharedWakes.length === edits;
const linkedValues = [];
for (let i = 0; i < sharedWakes.length; i++) {
    const snapshot = sharedWakes[i].next;
    const linked = snapshot[0].link?.get('row');
    const alias = linked === snapshot[1];
    if (!alias) aliasBothEdits = false;
    linkedValues.push(linked?.n ?? -1);
    if (i > 0 && sharedWakes[i].previous !== sharedWakes[i - 1].next) aliasBothEdits = false;
}
if (sharedWakes[0].previous[1].n !== 1) aliasBothEdits = false;

// Introduced sharing: link starts null, a Map is assigned, then two edits must both be aliased.
const introducedStore = new Carburetor({rows: makeRows(false), other: 0});
const introducedRawRow = introducedStore.getData().rows[1];
const introducedWakes = [];
const stopIntroduced = introducedStore.watch(d => d.rows, next => { introducedWakes.push(next); });
introducedStore.update(d => { d.rows[0].link = new Map([['row', introducedRawRow]]); });
introducedStore.update(d => { d.rows[1].n = 2; });
introducedStore.update(d => { d.rows[1].n = 3; });
stopIntroduced();
let introducedAlias = introducedWakes.length === 3;
for (const snapshot of introducedWakes.slice(1)) {
    if (snapshot[0].link?.get('row') !== snapshot[1] || snapshot[1].n !== 2 && snapshot[1].n !== 3) {
        introducedAlias = false;
    }
}

// Plain-list control: both edits publish through the cheap path.
const plainStore = new Carburetor({rows: makeRows(false), other: 0});
const plainWakes = [];
const stopPlain = plainStore.watch(d => d.rows, next => { plainWakes.push(next); });
plainStore.update(d => { d.rows[1].n = 2; });
plainStore.update(d => { d.rows[1].n = 3; });
stopPlain();
const plainValues = plainWakes.map(snapshot => snapshot[1].n).join(',');

emit({
    aliasBothEdits,
    linkedValues: linkedValues.join(','),
    introducedAlias,
    plainValues,
    done: aliasBothEdits && introducedAlias && linkedValues.join(',') === '2,3' && plainValues === '2,3',
});
