/** Public-only R41 Computed checks; usable for either direction of a mixed-format graph.
 *
 * @param assert - strict consumer assertions
 * @param producer - public store/inner-computed module
 * @param recorder - public downstream-computed module
 * @param label - format direction
 */
export const computed41Checks = (assert, producer, recorder, label) => {
    // Keep the first graph uid-only: the frozen build must reach the value assertion.
    // Domain-collision fixtures intentionally declare undocumented application members.
    /* oxlint-disable carburetor-internal/require-tsdoc */
    class Named extends producer.Computed {
        uid = 'total';
    }
    // Broader domain shadows separately exercise state and callbacks on the fixed build.
    class Domain extends producer.Computed {
        uid = 'total'; version = 900; value = 'domain'; valid = false;
        dependencies = 'domain'; versions = 'domain'; announced = 'domain';
        body = 'domain'; options = 'domain'; subscribers = 'domain';
        onDependencyChanged = () => { throw new Error('domain callback invoked'); };
        markStale = this.onDependencyChanged; settle = this.onDependencyChanged;
        recompute = this.onDependencyChanged; deliver = this.onDependencyChanged;
    }
    /* oxlint-enable carburetor-internal/require-tsdoc */
    const a = new producer.Carburetor({n: 1});
    const b = new producer.Carburetor({n: 2});
    const first = new Named(read => read(a).n);
    const second = new Named(read => read(b).n);
    const sum = new recorder.Computed(read => read(first) + read(second));
    const events = [];
    const id = sum.subscribe(() => events.push(sum.get()));
    assert.equal(sum.get(), 3, label + ': initial');
    b.update(draft => { draft.n = 3; });
    assert.equal(sum.get(), 4, label + ': collision sum');
    assert.deepEqual(events, [4], label + ': collision delivery');
    assert.notEqual(first.getUID(), second.getUID());
    sum.unsubscribe(id);
    const domain = new Domain(read => read(b).n);
    const domainId = domain.subscribe(() => {});
    assert.equal(domain.get(), 3, label + ': domain value');
    assert.equal(domain.version, 900);
    assert.equal(domain.value, 'domain');
    domain.unsubscribe(domainId);
    let version = 0;
    let value = 5;
    let fail = true;
    const listeners = new Map();
    const external = {
        getUID: () => 'external41', getVersion: () => version, get: () => value,
        subscribe(callback, options) {
            listeners.set(options.id, callback);
            if (fail) throw new Error('attachment41');
            return options.id;
        },
        unsubscribe: id => listeners.delete(id),
    };
    const mixed = new recorder.Computed(read => read(second) + read(external));
    assert.throws(() => mixed.subscribe(() => {}, {id: 'failed'}), /attachment41/);
    assert.equal(listeners.size, 0, label + ': failed attachment rolled back');
    fail = false;
    let deliveries = 0;
    const live = mixed.subscribe(() => { deliveries++; });
    assert.equal(mixed.get(), 8);
    value = 6; version++;
    for (const callback of Array.from(listeners.values())) callback();
    assert.equal(mixed.get(), 9);
    assert.equal(deliveries, 1);
    mixed.unsubscribe(live);
    assert.equal(listeners.size, 0);
    return [label + ':R41-01-collision', label + ':R41-01-external-rollback'];
};
