import {test, expect} from '@rstest/core';
import {Counter} from '../../../../examples/readme/Interop/CounterAction';

test('CounterAction example publishes its two writes once', () => {
    const store = new Counter();
    let deliveries = 0;
    store.subscribe(() => { deliveries++; });
    store.addTwice();
    expect(store.getData().value).toBe(2);
    expect(deliveries).toBe(1);
});
