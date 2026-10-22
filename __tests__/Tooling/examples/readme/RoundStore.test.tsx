import {test, expect} from '@rstest/core';
import {act, render} from '@testing-library/react';
import {CarburetorProvider, CarburetorScope} from '@/Carburetor';
import {RoundStore, countKinds, countWrong} from '../../../../examples/readme/App/RoundStore';
import {RoundKindView, ScopedVisibleRound, scopedRoundToken} from
    '../../../../examples/readme/Computed/ScopedRound';
import {clockTest, registerStoreTest, scopeTest} from '../../../../examples/readme/App/StoreTesting';

registerStoreTest();
test('testing helper flushes throttled watch', scopeTest);
test('test clock drives after()', clockTest);

test('module const object mutators take arguments and readonly helper reads its input', () => {
    const store = new RoundStore({round: {kind: 'quiz', wrong: [0, 0], locked: false}});
    store.markWrong(1);
    expect(store.getData().round.wrong).toEqual([0, 1]);
    expect(countWrong(store.getData())).toBe(1);
    expect(countKinds(['quiz', 'bonus'])).toBe(2);
});

test('finishRound sends one watch notification; separate writes send two', () => {
    const separateStore = new RoundStore({round: {kind: 'quiz', wrong: [0], locked: false}});
    let separate = 0;
    const stopSeparate = separateStore.watch(
        (data) => [data.round.wrong[0], data.round.locked],
        () => { separate++; }
    );
    separateStore.markWrong(0);
    separateStore.lockWin();
    expect(separate).toBe(2);
    stopSeparate();

    const batchedStore = new RoundStore({round: {kind: 'quiz', wrong: [0], locked: false}});
    let batched = 0;
    const stopBatched = batchedStore.watch(
        (data) => [data.round.wrong[0], data.round.locked],
        () => { batched++; }
    );
    batchedStore.finishRound();
    expect(batched).toBe(1);
    stopBatched();
});

test('scoped computed values are isolated; tracked kind ignores other round fields', () => {
    const left = new CarburetorScope();
    const right = new CarburetorScope();
    const leftStore = left.get(scopedRoundToken);
    const rightStore = right.get(scopedRoundToken);
    let kindRenders = 0;
    const leftTree = render(
        <CarburetorProvider scope={left}>
            <><ScopedVisibleRound/><RoundKindView onRender={() => { kindRenders++; }}/></>
        </CarburetorProvider>
    );
    const rightTree = render(
        <CarburetorProvider scope={right}>
            <><ScopedVisibleRound/><RoundKindView onRender={() => {}}/></>
        </CarburetorProvider>
    );
    expect(leftTree.container.querySelector('.visible')?.textContent).toBe('0,1');
    expect(rightTree.container.querySelector('.visible')?.textContent).toBe('0,1');
    expect(kindRenders).toBe(1);

    act(() => { leftStore.markWrong(0); });
    expect(leftTree.container.querySelector('.visible')?.textContent).toBe('1');
    expect(rightTree.container.querySelector('.visible')?.textContent).toBe('0,1');
    expect(kindRenders).toBe(1);

    act(() => { leftStore.setData({round: {...leftStore.getData().round, kind: 'bonus'}}); });
    expect(leftTree.container.querySelector('.kind')?.textContent).toBe('bonus');
    expect(kindRenders).toBe(2);

    act(() => { rightStore.markWrong(1); });
    expect(leftTree.container.querySelector('.visible')?.textContent).toBe('1');
    expect(rightTree.container.querySelector('.visible')?.textContent).toBe('0');
    leftTree.unmount();
    rightTree.unmount();
});
