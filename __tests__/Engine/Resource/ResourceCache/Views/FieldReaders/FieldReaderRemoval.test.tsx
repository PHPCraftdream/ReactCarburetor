import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, ComponentUpdateThrottle} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

const fixture = (scheduler?: ManualThrottle) => {
    const calls: number[] = [];
    const state = {renders: 0};
    const cache = new ResourceCache<{id: number}, number>((id) => {
        calls.push(id);
        return new Promise<{id: number}>(() => undefined);
    }, scheduler ? {scheduler} : {});

    class Reader extends AntiHookComponent {
        public render() {
            state.renders++;
            const view = this.useResource(cache, 1);
            return <span>{view.data ? 'data' : 'none'}</span>;
        }
    }

    return {cache, calls, state, Reader};
};

describe('R39-07 data-only readers keep their reload when the pending entry disappears', () => {
    test('forgetting the pending entry reloads it', async () => {
        const {cache, calls, state, Reader} = fixture();
        const view = render(<Reader/>);
        expect(calls).toEqual([1]);
        const rendersAfterMount = state.renders;

        await act(async () => { cache.forget(1); });

        expect(calls).toEqual([1, 1]);
        expect(state.renders).toBeGreaterThan(rendersAfterMount);
        view.unmount();
    });

    test('a restore inside the throttle window of the creation reloads it', async () => {
        const throttle = new ManualThrottle();
        const {cache, calls, state, Reader} = fixture(throttle);
        const view = render(<Reader/>);
        expect(calls).toEqual([1]);
        const rendersAfterMount = state.renders;

        // Creation and removal reach the reader as one collapsed notification.
        await act(async () => {
            cache.restore({entries: {}});
            throttle.flush();
        });

        expect(calls).toEqual([1, 1]);
        expect(state.renders).toBeGreaterThan(rendersAfterMount);
        view.unmount();
    });

    test('control: the creation alone is still not a render for a data-only reader', async () => {
        const throttle = new ManualThrottle();
        const {calls, state, Reader} = fixture(throttle);
        const view = render(<Reader/>);
        const rendersAfterMount = state.renders;

        await act(async () => { throttle.flush(); });

        expect(calls).toEqual([1]);
        expect(state.renders).toBe(rendersAfterMount);
        view.unmount();
    });
});
