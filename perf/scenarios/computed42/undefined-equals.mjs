import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const label = value => value === undefined ? 'undefined' : value === null ? 'null' : String(value);
const cases = [];
for (const observed of [false, true]) {
    for (const start of [false, true]) {
        for (const accept of [false, true]) {
            const store = new Carburetor({present: start, tick: 0, noise: 0});
            const comparisons = [];
            const deliveries = [];
            let bodies = 0;
            const value = computed(read => {
                bodies++;
                const data = read(store);
                void data.tick;
                return data.present ? null : undefined;
            }, {equals: (before, after) => {
                comparisons.push([label(before), label(after)]);
                return accept && before == null && after == null;
            }});
            const id = observed ? value.subscribe(() => deliveries.push(label(value.get()))) : undefined;
            try {
                const initial = value.get();
                const coldCalls = comparisons.length;
                const coldVersion = value.getVersion();
                store.update(draft => { draft.present = !draft.present; });
                const current = value.get();
                const stable = value.get();
                const version = value.getVersion();
                const next = start ? undefined : null;
                const expected = accept ? initial : next;
                const expectedPair = JSON.stringify([[label(initial), label(next)]]);
                const exactArguments = JSON.stringify(comparisons) === expectedPair;
                const callsAfterChange = comparisons.length;
                const bodiesAfterChange = bodies;
                const deliveriesAfterChange = deliveries.length;
                store.update(draft => { draft.noise++; });
                const noise = value.get();
                const noiseQuiet = bodies === bodiesAfterChange && comparisons.length === callsAfterChange
                    && deliveries.length === deliveriesAfterChange && Object.is(noise, expected);
                const eventValues = deliveries.join(',');
                const retained = Object.is(current, expected) && Object.is(stable, expected);
                const versions = coldVersion === 0 && version === (observed && !accept ? 1 : 0);
                cases.push({observed, start, accept, initial: label(initial), current: label(current),
                    stable: label(stable), coldCalls, coldVersion, version, comparisons: JSON.stringify(comparisons),
                    expectedPair, deliveries: eventValues, bodies: bodiesAfterChange, exactArguments, retained,
                    versions, noiseQuiet, deliveryCorrect: eventValues === (observed && !accept ? label(next) : '')});
            } finally { if (id !== undefined) value.unsubscribe(id); }
        }
    }
}
const sameReference = [];
for (const observed of [false, true]) {
    for (const start of [false, true]) {
        const store = new Carburetor({tick: 0});
        let calls = 0;
        let bodies = 0;
        let deliveries = 0;
        const value = computed(read => {
            bodies++;
            void read(store).tick;
            return start ? null : undefined;
        }, {equals: () => { calls++; return false; }});
        const id = observed ? value.subscribe(() => { deliveries++; }) : undefined;
        try {
            const initial = value.get();
            store.update(draft => { draft.tick++; });
            const current = value.get();
            sameReference.push(calls === 0 && bodies === 2 && deliveries === 0
                && value.getVersion() === 0 && Object.is(initial, current));
        } finally { if (id !== undefined) value.unsubscribe(id); }
    }
}
emit({caseCount: cases.length, coldCalls: cases.reduce((sum, value) => sum + value.coldCalls, 0),
    exactArguments: cases.every(value => value.exactArguments), baselineRetained: cases.every(value => value.retained),
    versionsCorrect: cases.every(value => value.versions),
    deliveriesCorrect: cases.every(value => value.deliveryCorrect),
    bodiesCorrect: cases.every(value => value.bodies === 2), noiseQuiet: cases.every(value => value.noiseQuiet),
    sameReferenceCorrect: sameReference.every(Boolean), evidence: JSON.stringify(cases), done: true});
