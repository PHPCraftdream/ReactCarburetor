/* Consumer check: a keyless (externally set) answer never satisfies earlier arguments. */
/**
 * Runs inside the generated consumer script.
 *
 * @param storeModule - the package entry under test (CommonJS or ESM build)
 * @param label - the cell label prefixed to assertion messages
 * @param assert - node:assert/strict from the consumer script
 */
export const checkKeylessAnswer = async (storeModule, label, assert) => {
    let loads = 0;
    const manual = new storeModule.ResourceCarburetor(async (key) => {
        loads++;
        return 'network-' + key;
    });
    await manual.load('a');
    const settled = manual.getData();
    manual.setData(settled);
    assert.equal(manual.snapshot().key, JSON.stringify('a'));
    let observedKey;
    const keyWatch = manual.subscribe(() => { observedKey = manual.snapshot().key; });
    manual.setData({...settled});
    manual.unsubscribe(keyWatch);
    assert.equal(observedKey, undefined, label + ': key loss was visible at publication');
    // The keyless data never answers 'a'; the remembered loader answer for 'a' does (D1).
    assert.equal(manual.suspend('a'), 'network-a', label + ': keyless answer must not satisfy old args');
    assert.equal(loads, 1);
    assert.equal(manual.snapshot().key, JSON.stringify('a'));

    // Without memory the keyless answer still must not satisfy 'a': a fresh request runs.
    let bareLoads = 0;
    const bare = new storeModule.ResourceCarburetor(async (key) => {
        bareLoads++;
        return 'network-' + key;
    }, {maxEntries: 0});
    await bare.load('a');
    bare.setData({...bare.getData()});
    let pendingLoad;
    try { bare.suspend('a'); } catch (value) { pendingLoad = value; }
    assert.ok(pendingLoad instanceof Promise, label + ': keyless answer must not satisfy old args (no memory)');
    await pendingLoad;
    assert.deepEqual([bareLoads, bare.suspend('a')], [2, 'network-a']);
};
