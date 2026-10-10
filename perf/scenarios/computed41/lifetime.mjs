import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emit, load} from '../../harness/lib.mjs';

if (!process.argv.includes('--child')) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child'],
        {encoding: 'utf8', env: process.env});
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
    process.stdout.write(child.stdout);
} else {
    if (typeof globalThis.gc !== 'function') throw new Error('GC must be exposed in lifetime child');
    const {Carburetor, computed} = await load();
    const store = new Carburetor({large: true, n: 0});
    const current = computed(read => read(store).large
        ? Array.from({length: 10000}, (_, id) => ({id, label: 'row-' + id})) : read(store).n);
    // Speculative read sources must collect after failed evaluation rollback and last release.
    let retired = new Carburetor({n: 7});
    const sourceRef = new WeakRef(retired);
    let obsolete = new Carburetor({n: 8});
    const obsoleteRef = new WeakRef(obsolete);
    const evaluated = computed(read => read(store).large ? read(obsolete).n : 0);
    const evaluatedId = evaluated.subscribe(() => {});
    evaluated.unsubscribe(evaluatedId);
    let capturedView;
    // A failed first body has no valid version cache holding the speculative source.
    // Last-release cleanup alone must remove its strong recorder filing.
    const sourceOwner = computed(read => {
        if (!read(store).large) return 0;
        capturedView = read(retired);
        void capturedView.n;
        throw new Error('source-lifetime41');
    });
    let failedBody = false;
    try { sourceOwner.subscribe(() => {}); }
    catch (error) { failedBody = error.message === 'source-lifetime41'; }
    const viewRef = new WeakRef(capturedView);
    capturedView = undefined;
    const id = current.subscribe(() => {});
    const old = new WeakRef(current.get());
    // A strongly held, equally sized positive control prevents a vacuous GC pass.
    const held = Array.from({length: 10000}, (_, id) => ({id}));
    const control = new WeakRef(held);
    current.unsubscribe(id);
    store.update(draft => { draft.large = false; });
    const scalar = current.get();
    const evaluatedScalar = evaluated.get();
    obsolete = undefined;
    retired = undefined;
    const heldSource = new Carburetor({n: 9});
    const sourceControl = new WeakRef(heldSource);
    // Return before GC so suspended async-frame loop temporaries cannot own retired sources.
    const setupSwitching = () => {
        // Keep old cached views strongly alive while their observed owners switch sources.
        // Both distinct ids and reused ids must retire recorder routes, without last release.
        const retainedViews = [];
        const retiredSources = [];
        const retiredRefs = [];
        const switching = [false, true].map(reuseId => {
            let selected = new Carburetor({left: 10, right: 11});
            if (reuseId) selected.getUID = () => 'retained-view41';
            let latestView;
            let bodyRuns = 0;
            const owner = computed(read => {
                bodyRuns++;
                void read(store).n;
                latestView = read(selected);
                return latestView.left;
            });
            let delivered = 0;
            const subscription = owner.subscribe(() => { delivered++; });
            for (const left of [20, 30, 40]) {
                retainedViews.push(latestView);
                retiredSources.push(selected);
                retiredRefs.push(new WeakRef(selected));
                selected = new Carburetor({left, right: left + 1});
                if (reuseId) selected.getUID = () => 'retained-view41';
                store.update(draft => { draft.n++; });
            }
            return {owner, subscription, selected, delivered: () => delivered, runs: () => bodyRuns};
        });
        const switchValues = switching.every(({owner}) => owner.get() === 40);
        // Scalar equality cannot prove precision: count actual evaluations as well as deliveries.
        // Keep retired sources alive until their real writes have exercised the closed routes.
        for (const view of retainedViews) void view.right;
        const before = switching.map(({delivered, runs}) => ({delivered: delivered(), runs: runs()}));
        for (const source of retiredSources) source.update(draft => { draft.right++; });
        const retiredRightRuns = switching.map(({runs}, index) => runs() - before[index].runs);
        for (const {selected} of switching) selected.update(draft => { draft.right++; });
        const replacementRightRuns = switching.map(({runs}, index) =>
            runs() - before[index].runs - retiredRightRuns[index]);
        const oldViewsPrecise = switching.every(({delivered, runs}, index) =>
            delivered() === before[index].delivered && runs() === before[index].runs);
        // Positive control: the actual observed leaf must reevaluate and deliver its new value once.
        for (const {selected} of switching) selected.update(draft => { draft.left = 41; });
        const observedLeftRuns = switching.map(({runs}, index) => runs() - before[index].runs);
        const observedLeftDeliveries = switching.map(({delivered}, index) => delivered() - before[index].delivered);
        const observedLeftValues = switching.map(({owner}) => owner.get());
        retiredSources.length = 0;
        return {retainedViews, retiredRefs, switching, switchValues, retiredRightRuns,
            replacementRightRuns, oldViewsPrecise, observedLeftRuns, observedLeftDeliveries, observedLeftValues};
    };
    const {retainedViews, retiredRefs, switching, switchValues, retiredRightRuns,
        replacementRightRuns, oldViewsPrecise, observedLeftRuns, observedLeftDeliveries,
        observedLeftValues} = setupSwitching();
    const boundary = () => new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 16; i++) {
        await boundary();
        globalThis.gc();
    }
    await boundary();
    const collected = old.deref() === undefined;
    const controlAlive = control.deref() === held;
    const sourceCollected = sourceRef.deref() === undefined;
    const obsoleteCollected = obsoleteRef.deref() === undefined;
    const viewCollected = viewRef.deref() === undefined;
    const switchedSourcesCollected = retiredRefs.every(ref => ref.deref() === undefined);
    const retainedViewsAlive = retainedViews.length === 6
        && retainedViews.every((view, index) => view.left === [10, 20, 30][index % 3]);
    const switchingOwnersAlive = switching.every(({owner, selected}) =>
        owner.get() === 41 && selected.getData().left === 41);
    for (const {owner, subscription} of switching) owner.unsubscribe(subscription);
    const sourceControlAlive = sourceControl.deref() === heldSource && heldSource.getData().n === 9;
    const sourceScalar = sourceOwner.get();
    let deliveries = 0;
    const next = current.subscribe(() => { deliveries++; });
    store.update(draft => { draft.n = 1; });
    const final = current.get();
    // Read both owners after GC: neither may disappear to justify collection.
    const ownersAlive = store.getData().n === 1 && current.get() === 1
        && sourceOwner.get() === 0 && evaluated.get() === 0;
    current.unsubscribe(next);
    emit({scalar, collected, controlAlive, failedBody, sourceScalar, sourceCollected, viewCollected,
        evaluatedScalar, obsoleteCollected, sourceControlAlive, ownersAlive, final, deliveries,
        switchValues, oldViewsPrecise, retiredRightRuns: retiredRightRuns.join(','),
        replacementRightRuns: replacementRightRuns.join(','), observedLeftRuns: observedLeftRuns.join(','),
        observedLeftDeliveries: observedLeftDeliveries.join(','), observedLeftValues: observedLeftValues.join(','),
        switchedSourcesCollected, retainedViewsAlive, switchingOwnersAlive, done: true});
}
