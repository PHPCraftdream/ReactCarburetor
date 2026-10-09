import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor, ComponentUpdateThrottle} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

class ControlledThrottle extends ComponentUpdateThrottle {
    constructor() { super(60_000); }

    public flush(): void { this.letsUpdate(); }
}

class InspectableStore extends Carburetor<{n: number}> {
    public subscriberCount(): number { return Object.keys(this[S.subscribers]).length; }
}

describe('throttle delivery cancellation', () => {
    test('cancellation during a flush skips the captured callback without losing other subscribers', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];

        scheduler.schedule('a', () => {
            delivered.push('a');
            scheduler.cancel('b');
        });
        scheduler.schedule('b', () => delivered.push('obsolete'));
        scheduler.schedule('c', () => delivered.push('c'));
        scheduler.flush();

        expect(delivered).toEqual(['a', 'c']);
    });

    test('cancel and resubscribe in a round delivers only the new callback, after untouched callbacks', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];

        scheduler.schedule('a', () => {
            delivered.push('a');
            scheduler.cancel('b');
            scheduler.schedule('b', () => delivered.push('replacement'));
        });
        scheduler.schedule('b', () => delivered.push('obsolete'));
        scheduler.schedule('c', () => delivered.push('c'));
        scheduler.flush();

        expect(delivered).toEqual(['a', 'c', 'replacement']);
        scheduler.schedule('b', () => delivered.push('later'));
        scheduler.flush();
        expect(delivered).toEqual(['a', 'c', 'replacement', 'later']);
    });

    test('same-id schedule replaces a captured callback and can itself be cancelled', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];

        scheduler.schedule('a', () => {
            scheduler.schedule('b', () => delivered.push('replacement'));
        });
        scheduler.schedule('b', () => delivered.push('obsolete'));
        scheduler.flush();
        expect(delivered).toEqual(['replacement']);

        scheduler.schedule('a', () => {
            scheduler.schedule('b', () => delivered.push('cancelled replacement'));
            scheduler.cancel('b');
        });
        scheduler.schedule('b', () => delivered.push('obsolete again'));
        scheduler.flush();
        expect(delivered).toEqual(['replacement']);
    });

    test('nested flush cancellation reaches an enclosing round that has not finished', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];
        scheduler.schedule('a', () => {
            delivered.push('a');
            scheduler.schedule('nested', () => {
                delivered.push('nested');
                scheduler.cancel('b');
            });
            scheduler.flush();
        });
        scheduler.schedule('b', () => delivered.push('obsolete'));
        scheduler.schedule('c', () => delivered.push('c'));
        scheduler.flush();
        expect(delivered).toEqual(['a', 'nested', 'c']);
    });

    test('nested flush replacement removes the enclosing callback but preserves nested order', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];
        scheduler.schedule('a', () => {
            delivered.push('a');
            scheduler.schedule('nested', () => {
                delivered.push('nested');
                scheduler.schedule('b', () => delivered.push('replacement'));
            });
            scheduler.flush();
        });
        scheduler.schedule('b', () => delivered.push('obsolete'));
        scheduler.schedule('c', () => delivered.push('c'));
        scheduler.flush();
        expect(delivered).toEqual(['a', 'nested', 'replacement', 'c']);
    });

    test('public unsubscribe during a flush prevents later subscriber delivery', () => {
        const scheduler = new ControlledThrottle();
        const store = new InspectableStore({n: 0}, scheduler);
        const delivered: string[] = [];
        store.subscribe(() => {
            delivered.push('a');
            store.unsubscribe('b');
        }, {id: 'a'});
        store.subscribe(() => delivered.push('b'), {id: 'b'});

        store.setData({n: 1});
        scheduler.flush();
        expect(delivered).toEqual(['a']);
        expect(store.subscriberCount()).toBe(1);
        store.unsubscribe('a');
    });

    test('unsubscribing and replacing a store subscriber cancels queued old registrations', () => {
        const scheduler = new ControlledThrottle();
        const store = new Carburetor({n: 0}, scheduler);
        const delivered: string[] = [];
        store.subscribe(() => {
            delivered.push('a');
            store.unsubscribe('b');
            store.subscribe(() => delivered.push('new b'), {id: 'b'});
        }, {id: 'a'});
        store.subscribe(() => delivered.push('old b'), {id: 'b'});
        store.setData({n: 1});
        scheduler.flush();
        expect(delivered).toEqual(['a']);

        store.unsubscribe('a');
        store.setData({n: 2});
        scheduler.flush();
        expect(delivered).toEqual(['a', 'new b']);
        store.unsubscribe('b');

        const replacement = new Carburetor({n: 0}, scheduler);
        replacement.subscribe(() => delivered.push('obsolete'), {id: 'same'});
        replacement.setData({n: 1});
        replacement.subscribe(() => delivered.push('current'), {id: 'same'});
        scheduler.flush();
        expect(delivered).toEqual(['a', 'new b']);
        replacement.setData({n: 2});
        scheduler.flush();
        expect(delivered).toEqual(['a', 'new b', 'current']);
        replacement.unsubscribe('same');
    });

    test('store same-id replacement inside delivery removes the old callback without scheduling the new one', () => {
        const scheduler = new ControlledThrottle();
        const store = new Carburetor({n: 0}, scheduler);
        const delivered: string[] = [];
        store.subscribe(() => {
            delivered.push('a');
            store.subscribe(() => delivered.push('replacement'), {id: 'b'});
        }, {id: 'a'});
        store.subscribe(() => delivered.push('obsolete'), {id: 'b'});

        store.setData({n: 1});
        scheduler.flush();
        expect(delivered).toEqual(['a']);

        store.unsubscribe('a');
        store.setData({n: 2});
        scheduler.flush();
        expect(delivered).toEqual(['a', 'replacement']);
        store.unsubscribe('b');
    });

    test('a throwing callback does not skip pending or reentrant work or poison the next flush', () => {
        const scheduler = new ControlledThrottle();
        const delivered: string[] = [];
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            scheduler.schedule('first', () => {
                delivered.push('first');
                scheduler.schedule('next round', () => delivered.push('next round'));
                throw new Error('failed first');
            });
            scheduler.schedule('second', () => delivered.push('second'));
            scheduler.flush();
            scheduler.schedule('later', () => delivered.push('later'));
            scheduler.flush();
            expect(delivered).toEqual(['first', 'second', 'next round', 'later']);
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('reentrant scheduling remains bounded by the depth guard and recovers on the next flush', () => {
        class LimitedThrottle extends ControlledThrottle {
            constructor() {
                super();
                this.maxUpdateDepth = 2;
            }
        }
        const scheduler = new LimitedThrottle();
        let calls = 0;
        const again = () => {
            calls++;
            scheduler.schedule('loop', again);
        };

        scheduler.schedule('loop', again);
        expect(() => scheduler.flush()).toThrow('exceeded max update depth');
        expect(calls).toBe(2);
        scheduler.flush();
        expect(calls).toBe(2);
        scheduler.schedule('clean', () => { calls++; });
        scheduler.flush();
        expect(calls).toBe(3);
    });

    test('recursive explicit flushes share the loop budget and allow recovery', () => {
        class LimitedThrottle extends ControlledThrottle {
            constructor() {
                super();
                this.maxUpdateDepth = 3;
            }
        }
        const scheduler = new LimitedThrottle();
        let calls = 0;
        const again = () => {
            calls++;
            scheduler.schedule('loop', again);
            scheduler.flush();
        };

        scheduler.schedule('loop', again);
        expect(() => scheduler.flush()).toThrow('exceeded max update depth');
        expect(calls).toBe(3);
        scheduler.flush();
        expect(calls).toBe(3);
        scheduler.schedule('clean', () => { calls++; });
        scheduler.flush();
        expect(calls).toBe(4);
    });

    test('unmount from an earlier callback cancels the hook subscription already queued', () => {
        const scheduler = new ControlledThrottle();
        const store = new InspectableStore({n: 0}, scheduler);
        const delivered: string[] = [];
        let unmount = () => undefined;
        store.subscribe(() => {
            delivered.push('a');
            unmount();
        }, {id: 'a'});

        let renders = 0;
        const View = () => {
            renders++;
            const n = useCarburetorValue(store, (data) => data.n);
            return <span>{n}</span>;
        };
        const mounted = render(<View/>);
        unmount = mounted.unmount;
        expect(store.subscriberCount()).toBe(2);
        const before = renders;

        act(() => {
            store.setData({n: 1});
            scheduler.flush();
        });

        expect(delivered).toEqual(['a']);
        expect(renders).toBe(before);
        expect(store.subscriberCount()).toBe(1);
        expect(mounted.container.textContent).toBe('');
        store.unsubscribe('a');
        expect(store.subscriberCount()).toBe(0);
    });
});
