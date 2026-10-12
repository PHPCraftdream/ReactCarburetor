import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emit, load, loadPath, engine} from '../../harness/lib.mjs';

if (!process.argv.includes('--child')) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child'],
        {encoding: 'utf8', env: process.env, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1048576});
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
    process.stdout.write(child.stdout);
} else {
    assert.equal(typeof globalThis.gc, 'function');
    const {Carburetor, computed} = await load();
    const {computedDependencies} = await loadPath('Carburetor/Derived/computedDependencies.mjs');
    const token = owner => owner[Symbol.for('react-carburetor/v1/computed-snapshot-version')]();
    const makeOwner = (gate, choice, projection) => {
        let runs = 0;
        const owner = computed(read => {
            runs++;
            void read(gate).tick;
            const data = read(choice.current);
            return projection ? {n: data.n, payload: data.payload} : data.n;
        }, projection ? {equals: (before, after) => before.n === after.n} : undefined);
        return {owner, runs: () => runs};
    };
    const observe = (owner, events) => owner.subscribe(() => events.push(owner.get()));
    const contains = (versions, uid) => Object.values(versions).some(record => record.source.getUID() === uid);
    const setup = kind => {
        const projection = kind === 'held-result-live';
        const gate = new Carburetor({tick: 0});
        const choice = {current: new Carburetor({n: 1, payload: Array.from({length: 32}, (_, i) => ({i}))})};
        const {owner, runs} = makeOwner(gate, choice, projection);
        const events = [];
        const id = kind === 'unobserved' ? undefined : observe(owner, events);
        const baseline = owner.get();
        const previous = choice.current;
        const uid = previous.getUID();
        const ref = new WeakRef(previous);
        const payloadRef = new WeakRef(previous.getData().payload);
        const held = kind === 'strong' ? previous : undefined;
        const expected = kind === 'changed' ? 2 : 1;
        choice.current = new Carburetor({n: expected, payload: [{replacement: true}]});
        gate.update(draft => { draft.tick++; });
        const accepted = owner.get();
        assert.equal(projection ? accepted.n : accepted, expected);
        if (projection) assert.equal(accepted, baseline);
        assert.deepEqual(events, kind === 'changed' ? [2] : []);
        assert.equal(token(owner), kind === 'changed' || kind === 'unobserved' && expected !== 1 ? 1 : 0);
        assert.equal(owner.getVersion(), kind === 'changed' ? 1 : 0);
        const before = runs();
        previous.update(draft => { draft.n = 9; });
        assert.equal(owner.get(), accepted);
        assert.equal(runs(), before);
        assert.equal(contains(computedDependencies.versions.get(owner)(), uid), false);
        const announcementHasOld = contains(engine(owner, 'announced')?.versions ?? {}, uid);
        return {kind, projection, owner, runs, gate, choice, events, id, ref, payloadRef, held,
            heldResult: projection ? baseline : undefined, expected, announcementHasOld};
    };
    const setupUnreachable = () => new WeakRef(new Carburetor({n: 1}));
    const lanes = ['equal', 'changed', 'unobserved', 'strong', 'held-result-live'].map(setup);
    const unreachable = setupUnreachable();
    const boundary = () => new Promise(resolve => setImmediate(resolve));
    const collect = async () => {
        for (let i = 0; i < 16; i++) { await boundary(); globalThis.gc(); }
        await boundary();
    };
    await collect();
    const before = lanes.map(lane => ({kind: lane.kind, sourceAlive: lane.ref.deref() !== undefined,
        payloadAlive: lane.payloadRef.deref() !== undefined, announcementHasOld: lane.announcementHasOld}));
    assert.equal(unreachable.deref(), undefined);
    for (const kind of ['changed', 'unobserved']) {
        assert.equal(before.find(row => row.kind === kind).sourceAlive, false);
        assert.equal(before.find(row => row.kind === kind).payloadAlive, false);
    }
    const strong = lanes.find(lane => lane.kind === 'strong');
    assert.equal(strong.ref.deref(), strong.held);
    const projection = lanes.find(lane => lane.projection);
    assert.equal(projection.owner.get(), projection.heldResult);
    assert.ok(projection.payloadRef.deref() !== undefined);
    assert.equal(projection.heldResult.payload.length, 32);
    for (const lane of lanes) {
        assert.equal(lane.projection ? lane.owner.get().n : lane.owner.get(), lane.expected);
        assert.equal(lane.gate.getData().tick, 1);
    }
    const equal = lanes.find(lane => lane.kind === 'equal');
    const activeRuns = equal.runs();
    equal.choice.current.update(draft => { draft.n = 2; });
    assert.equal(equal.owner.get(), 2);
    assert.equal(equal.runs(), activeRuns + 1);
    assert.deepEqual(equal.events, [2]);
    assert.equal(equal.owner.getVersion(), 1);
    assert.equal(token(equal.owner), 1);
    for (const lane of lanes) if (lane.id !== undefined) lane.owner.unsubscribe(lane.id);
    await collect();
    const released = lanes.map(lane => ({kind: lane.kind, sourceAlive: lane.ref.deref() !== undefined}));
    assert.equal(released.find(row => row.kind === 'equal').sourceAlive, false);
    assert.equal(strong.ref.deref(), strong.held);
    assert.ok(projection.payloadRef.deref() !== undefined);
    assert.equal(projection.heldResult.payload.length, 32);
    const rejoined = observe(equal.owner, equal.events);
    try {
        const runs = equal.runs();
        equal.choice.current.update(draft => { draft.n = 3; });
        assert.equal(equal.owner.get(), 3);
        assert.equal(equal.runs(), runs + 1);
        assert.deepEqual(equal.events, [2, 3]);
        assert.equal(equal.owner.getVersion(), 2);
        assert.equal(token(equal.owner), 2);
    } finally { equal.owner.unsubscribe(rejoined); }
    const equalCollected = !before.find(row => row.kind === 'equal').sourceAlive;
    const equalPayloadCollected = !before.find(row => row.kind === 'equal').payloadAlive;
    const checkpointRetired = !before.find(row => row.kind === 'equal').announcementHasOld;
    emit({caseCount: 6, equalCollected, equalPayloadCollected, checkpointRetired,
        controlsCorrect: true, ownersAlive: true, retiredQuiet: true, replacementCorrect: true,
        releaseCorrect: true, projectionIdentity: true, heldResultLive: true,
        collectionUnit: 'retired source/payload WeakRef reachability after 16 GC job boundaries',
        gcRounds: 16, childTimeoutMs: 30000, evidence: JSON.stringify({before, released}), done: true});
}
