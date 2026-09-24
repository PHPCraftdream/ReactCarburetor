import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, computed} from '@/Carburetor';
import {CounterCarburetor, IndexedCarburetor, getIndexData} from './fixtures';

describe('computed', () => {
    describe('exotic results (R6-02)', () => {
        test('a coarse-path Map mutation notifies subscribers even though the result reference is unchanged', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            const index = computed<Map<string, number>>((read) => read(carburetor).index);

            index.subscribe(() => notified++, {id: 'listener'});

            expect(index.getVersion()).toEqual(0);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(index.getVersion()).toEqual(1);
            expect(index.get().get('a')).toEqual(2);
        });

        test('a component reading a Map-valued computed re-renders after a coarse mutation', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let renders = 0;

            const index = computed<Map<string, number>>((read) => read(carburetor).index);

            class ValueView extends AntiHookComponent {
                render() {
                    renders++;

                    return <div className="value">{this.useComputed(index).get('a')}</div>;
                }
            }

            const view = render(<ValueView />);
            expect(view.container.querySelector('.value')?.textContent).toEqual('1');
            expect(renders).toEqual(1);

            act(() => carburetor.setIndex('a', 2));

            expect(view.container.querySelector('.value')?.textContent).toEqual('2');
            expect(renders).toEqual(2);

            view.unmount();
        });

        test('an equal primitive result after a recompute still stays quiet (control)', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            const size = computed<number>((read) => read(carburetor).index.size);

            size.subscribe(() => notified++, {id: 'listener'});

            // The write lands on a tracked path and the body recomputes, but the result is the
            // same primitive: the reference check must keep suppressing the notification.
            carburetor.setIndex('a', 1);

            expect(notified).toEqual(0);
            expect(size.getVersion()).toEqual(0);
            expect(size.get()).toEqual(1);
        });
    });

    describe('stable plain envelopes hiding exotic members (R7-02)', () => {
        test('a stable envelope wrapping an exotic value notifies after the wrapped value mutates', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            // One envelope object, reused across evaluations; only its member is refreshed.
            const envelope: {index: Map<string, number>} = {index: new Map<string, number>()};

            const wrapped = computed<{index: Map<string, number>}>((read) => {
                envelope.index = read(carburetor).index;

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});

            expect(wrapped.getVersion()).toEqual(0);
            expect(wrapped.get().index.get('a')).toEqual(1);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get().index.get('a')).toEqual(2);
        });

        test('an exotic member below nested plain containers is found and notifies', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            interface IPage {
                index: Map<string, number>;
            }

            const envelope: {pages: IPage[]} = {pages: []};

            const wrapped = computed<{pages: IPage[]}>((read) => {
                envelope.pages = [{index: read(carburetor).index}];

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});

            expect(wrapped.get().pages[0].index.get('a')).toEqual(1);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get().pages[0].index.get('a')).toEqual(2);
        });

        test('an envelope that cycles through plain containers terminates and notifies', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            // The Map is reachable only through the cycle envelope -> child -> host -> envelope,
            // so the walk must survive the loop to find it.
            const child: {host: unknown; index: Map<string, number>} = {
                host: undefined,
                index: new Map<string, number>(),
            };

            const envelope: {child: {host: unknown; index: Map<string, number>}} = {child};

            child.host = envelope;

            const wrapped = computed<{child: {host: unknown; index: Map<string, number>}}>((read) => {
                child.index = read(carburetor).index;

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});

            expect(wrapped.get().child.index.get('a')).toEqual(1);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get().child.index.get('a')).toEqual(2);
        });

        test('a freshly constructed envelope already notifies through the reference check (control)', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            const wrapped = computed<{index: Map<string, number>}>((read) => ({
                index: read(carburetor).index,
            }));

            wrapped.subscribe(() => notified++, {id: 'listener'});

            expect(wrapped.getVersion()).toEqual(0);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get().index.get('a')).toEqual(2);
        });

        test('a stable envelope holding only plain data still stays quiet (control)', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let notified = 0;

            const envelope: {n: number} = {n: 0};

            const wrapped = computed<{n: number}>((read) => {
                envelope.n = read(carburetor).n;

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});

            expect(wrapped.get()).toEqual({n: 1});

            // The write re-runs the body and even changes the plain member's value, but with no
            // exotic member inside, the reference check keeps the notification suppressed.
            carburetor.setN(2);

            expect(notified).toEqual(0);
            expect(wrapped.getVersion()).toEqual(0);
            expect(wrapped.get()).toEqual({n: 2});
        });
    });

    describe('safe exotic result inspection (R8-01/R8-02/R8-05)', () => {
        test('a non-enumerable Map member notifies after a coarse mutation', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            const envelope: {index?: Map<string, number>} = {};
            let notified = 0;

            Object.defineProperty(envelope, 'index', {
                configurable: true,
                value: new Map<string, number>(),
                writable: true,
            });

            const wrapped = computed((read) => {
                envelope.index = read(carburetor).index;

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});
            expect(wrapped.get().index?.get('a')).toEqual(1);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get().index?.get('a')).toEqual(2);
        });

        test('a non-enumerable accessor is conservative and is never invoked', () => {
            const carburetor = new CounterCarburetor({n: 1});
            const result: {n?: number} = {};
            let getterCalls = 0;
            let notified = 0;

            Object.defineProperty(result, 'value', {
                get: () => {
                    getterCalls++;

                    return 1;
                },
            });

            const value = computed((read) => {
                result.n = read(carburetor).n;

                return result;
            });

            value.subscribe(() => notified++, {id: 'listener'});
            carburetor.setN(2);

            expect(getterCalls).toEqual(0);
            expect(notified).toEqual(1);
            expect(value.getVersion()).toEqual(1);
            expect(value.get()).toBe(result);
        });

        test('a stable envelope detects an enumerable symbol-keyed Map mutation', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            const indexKey = Symbol('index');
            const envelope: {[indexKey]: Map<string, number>} = {
                [indexKey]: new Map<string, number>(),
            };
            let notified = 0;

            const wrapped = computed<{[indexKey]: Map<string, number>}>((read) => {
                envelope[indexKey] = read(carburetor).index;

                return envelope;
            });

            wrapped.subscribe(() => notified++, {id: 'listener'});
            expect(wrapped.get()[indexKey].get('a')).toEqual(1);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(wrapped.getVersion()).toEqual(1);
            expect(wrapped.get()[indexKey].get('a')).toEqual(2);
        });

        test('a side-effecting getter is not invoked and still causes conservative notification', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let getterCalls = 0;
            let notified = 0;
            const result: {n?: number} = {};

            Object.defineProperty(result, 'value', {
                enumerable: true,
                get: () => {
                    getterCalls++;

                    return 1;
                },
            });

            const value = computed((read) => {
                result.n = read(carburetor).n;

                return result;
            });

            value.subscribe(() => notified++, {id: 'listener'});
            carburetor.setN(2);

            expect(getterCalls).toEqual(0);
            expect(notified).toEqual(1);
            expect(value.getVersion()).toEqual(1);
            expect(value.get()).toBe(result);
        });

        test('a throwing getter cannot interrupt successful recompute announcement', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let getterCalls = 0;
            let notified = 0;
            const result: {n?: number} = {};

            Object.defineProperty(result, 'value', {
                enumerable: true,
                get: () => {
                    getterCalls++;

                    throw new Error('getter touched');
                },
            });

            const value = computed((read) => {
                result.n = read(carburetor).n;

                return result;
            });

            value.subscribe(() => notified++, {id: 'listener'});
            carburetor.setN(2);

            expect(getterCalls).toEqual(0);
            expect(notified).toEqual(1);
            expect(value.getVersion()).toEqual(1);
            expect(value.get()).toBe(result);
        });

        test('a changed result reference notifies without inspecting its members', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let inspections = 0;
            let notified = 0;
            const value = computed((read) => {
                const n = read(carburetor).n;

                return new Proxy({n}, {
                    ownKeys: (target) => {
                        inspections++;

                        return Reflect.ownKeys(target);
                    },
                });
            });

            value.subscribe(() => notified++, {id: 'listener'});
            carburetor.setN(2);

            expect(inspections).toEqual(0);
            expect(notified).toEqual(1);
            expect(value.getVersion()).toEqual(1);
        });
    });

});
