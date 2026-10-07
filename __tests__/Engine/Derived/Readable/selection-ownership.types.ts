import {Carburetor, AntiHookComponent} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import type {TValueComparator} from '@/Interop/Models';

interface IData {n: number; tuple: [number, string]}
interface INativeData {map: Map<string, {n: number}>; set: Set<string>; date: Date}
class NativeStore extends Carburetor<INativeData> {}
const nativeStore = new NativeStore({map: new Map([['a', {n: 1}]]), set: new Set(['a']), date: new Date()});

const assertNativeReadonly = (value: import('@/Carburetor/Models/Base').TReadonly<INativeData>): void => {
    void value.map.get('a')?.n;
    value.set.has('a');
    value.date.getTime();
    // @ts-expect-error borrowed readonly Map excludes mutators
    value.map.set('b', {n: 2});
    // @ts-expect-error borrowed readonly Set excludes mutators
    value.set.add('b');
    // @ts-expect-error borrowed readonly Date excludes setters
    value.date.setTime(0);
};
void assertNativeReadonly;

nativeStore.watch(data => data, next => {
    next.map.get('a');
    next.set.has('a');
    next.date.getTime();
    // @ts-expect-error watch Map excludes mutators
    next.map.set('b', {n: 2});
    // @ts-expect-error watch Set excludes mutators
    next.set.add('b');
    // @ts-expect-error watch Date excludes setters
    next.date.setTime(0);
});

const nativeComparator: TValueComparator<INativeData> = (left, right) => {
    left.map.get('a');
    left.set.has('a');
    left.date.getTime();
    // @ts-expect-error comparator Map excludes mutators
    left.map.set('b', {n: 2});
    // @ts-expect-error comparator Set excludes mutators
    left.set.add('b');
    // @ts-expect-error comparator Date excludes setters
    left.date.setTime(0);
    return left.date.getTime() === right.date.getTime();
};
void nativeComparator;

const taggedDateStore = new Carburetor({date: Object.assign(new Date(), {details: {n: 1}})});
const taggedDateView = taggedDateStore.read(() => {});
taggedDateView.date.getTime();
// @ts-expect-error Date fields keep the recursively readonly tracked-view contract
taggedDateView.date.details.n = 2;

class Store extends Carburetor<IData> {}
const store = new Store({n: 1, tuple: [1, 'x']});

store.watch(data => ({n: data.n, tuple: [data.n, 'x'] as [number, string]}), next => {
    // @ts-expect-error watch projections are borrowed readonly plain objects
    next.n = 2;
    // @ts-expect-error tuple elements are readonly too
    next.tuple[0] = 2;
    const editable = {...next};
    editable.n = 2;
});

const hookValue = useCarburetorValue(store, data => ({n: data.n, tuple: [data.n, 'x'] as [number, string]}));
// @ts-expect-error hook selections are borrowed readonly plain objects
hookValue.n = 2;
// @ts-expect-error hook tuple elements are readonly
hookValue.tuple[0] = 2;

const comparator: TValueComparator<{n: number; tuple: readonly [number, string]}> = (left, right) => {
    // @ts-expect-error comparator arguments use the readonly selection contract
    left.n = right.n;
    // @ts-expect-error comparator tuple elements are readonly
    left.tuple[0] = 3;
    return left.n === right.n;
};
void comparator;

class View extends AntiHookComponent {
    private readonly select = this.connectSelection(
        store, data => ({n: data.n, tuple: [data.n, 'x'] as [number, string]})
    );
    public check(): void {
        const selected = this.select();
        // @ts-expect-error class selection is borrowed readonly
        selected.n = 2;
        // @ts-expect-error class selection tuple is readonly
        selected.tuple[0] = 2;
        const editable = {...selected};
        editable.n = 2;
    }
}

void View;

const snapshot = store.snapshot();
snapshot.n = 2;
