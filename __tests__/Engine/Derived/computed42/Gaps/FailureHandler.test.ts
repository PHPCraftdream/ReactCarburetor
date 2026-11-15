import {computed, diagnostics} from '@/Carburetor';
import {ExternalComputed} from '../../Computed/fixtures';

describe('computed subscriber failures reach the diagnostics failure handler', () => {
    test('a throwing subscriber is reported as thrown, and the next subscriber is still woken', () => {
        const source = new ExternalComputed(1);
        const doubled = computed(read => read(source) * 2);
        const boom = new Error('subscriber failed');
        const handled: Array<[unknown, string]> = [];
        let healthy = 0;

        doubled.subscribe(() => { throw boom; });
        doubled.subscribe(() => { healthy++; });

        diagnostics.setFailureHandler((error, origin) => { handled.push([error, origin]); });
        diagnostics.setEnabled(false);

        try {
            source.set(2);
        } finally {
            diagnostics.setEnabled(true);
            diagnostics.setFailureHandler(undefined);
        }

        expect(handled).toEqual([[boom, 'computed']]);
        expect(handled[0][0]).toBe(boom);
        expect(healthy).toBe(1);
        expect(doubled.get()).toBe(4);
    });
});
