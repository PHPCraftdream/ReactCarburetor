import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';

const fields = ['uid', 'effects', 'tracked', 'connections', 'renderAttempt', 'pendingAttempt',
    'committedAttempt', 'trackedViews', 'getRenderAttempt', 'onCarburetorUpdate'];
const helpers = ['installRenderBoundary', 'buildRenderBoundary', 'openRenderAttempt', 'closeRenderAttempt',
    'commitSubscriptions', 'ensureTracked', 'buildDescription', 'applyDescription', 'migrateConnectionReads',
    'alignSubscription', 'releaseSlot', 'releaseSubscriptions', 'declareConnection', 'loadStaleResources',
    'track', 'reportTeardownFailure', 'ensureEffects', 'releaseEffects'];
const reactNames = new Set(['props', 'context', 'refs', 'updater', 'state', 'render',
    '_reactInternals', '_reactInternalInstance']);

/** Publishes the public component-uid repro. */
class Users extends Carburetor<{name: string; initials: string}> {
    /** Changes both fields in one publication. */
    public rename(): void { this.update(draft => { draft.name = 'Grace'; draft.initials = 'Gr'; }); }
}

describe('R40-01 component subclass names', () => {
    test('C: two components with the same domain uid both render GraceGr', () => {
        const users = new Users({name: 'Ada', initials: 'Ad'});
        class Name extends AntiHookComponent {
            public uid = 'u1';
            public render(): React.ReactNode { return <b>{this.useCarburetor(users).name}</b>; }
        }
        class Avatar extends AntiHookComponent {
            public uid = 'u1';
            public render(): React.ReactNode { return <i>{this.useCarburetor(users).initials}</i>; }
        }
        const screen = render(<><Name /><Avatar /></>);
        expect(screen.container.textContent).toBe('AdaAd');
        act(() => users.rename());
        expect(screen.container.textContent).toBe('GraceGr');
        screen.unmount();
    });

    test('only React/public render names remain on an instance', () => {
        class Owner extends AntiHookComponent {
            public render(): React.ReactNode { return null; }
        }
        expect(Object.getOwnPropertyNames(new Owner({})).filter(name => !reactNames.has(name))).toEqual([]);
    });

    test.each([...fields, ...helpers])('shadow %s preserves reads, effects and release', name => {
        const users = new Users({name: 'Ada', initials: 'Ad'});
        let setups = 0;
        let cleanups = 0;
        class Owner extends AntiHookComponent {
            constructor(props: {}) {
                super(props);
                Object.defineProperty(this, name, {value: 'domain', configurable: true, writable: true});
            }
            protected useEffects(): void {
                this.useEffect('effect', () => { setups++; return () => { cleanups++; }; }, []);
            }
            public render(): React.ReactNode { return <b>{this.useCarburetor(users).name}</b>; }
        }
        const screen = render(<Owner />);
        expect(screen.container.textContent).toBe('Ada');
        act(() => users.rename());
        expect(screen.container.textContent).toBe('Grace');
        expect(setups).toBe(1);
        screen.unmount();
        expect(cleanups).toBe(1);
        act(() => users.rename());
    });
});
