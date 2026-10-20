import {Carburetor, diagnostics} from '@/Carburetor';
import {metadata} from '@/Carburetor/Store/Diagnostics/Internal/metadata';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

describe('diagnostic production guards', () => {
    test('diagnostics entries are behaviorally inert under NODE_ENV=production', () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const seen: unknown[] = [];
            const stop = diagnostics.traceUpdates(event => seen.push(event));
            expect(diagnostics.isTracing()).toBe(false);
            const store = new Carburetor({a: 0});
            store.subscribe(() => undefined, {id: 'prod-guard', reads: ['a']});
            store.setData({a: 1});
            store.unsubscribe('prod-guard');
            expect(seen).toHaveLength(0);
            stop();
            stop();
            expect(diagnostics.isTracing()).toBe(false);
            expect(diagnostics.getWideReadThreshold()).toBe(Number.POSITIVE_INFINITY);
            diagnostics.setWideReadThreshold(50);
            expect(diagnostics.getWideReadThreshold()).toBe(50);
            diagnostics.setWideReadThreshold(Infinity);
            const component = {marker: 'guard'};
            diagnostics.registerComponent(component, 'Hidden', () => undefined);
            expect(metadata.componentNames.has(component)).toBe(false);
            const reportSpy: unknown[][] = [];
            const originalError = console.error;
            console.error = (...args: unknown[]) => reportSpy.push(args);
            try {
                diagnostics.reportWideRead(component, {marker: 'store'}, 'store-uid', 1000);
            } finally {
                console.error = originalError;
            }
            expect(reportSpy).toHaveLength(0);
        } finally {
            process.env.NODE_ENV = previous;
        }
    });

    test('literal non-production guards remain at the trace and wide-read call sites', () => {
        const subscriptions = readFileSync(
            resolve(process.cwd(), 'lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx'), 'utf8'
        );
        const carburetor = readFileSync(resolve(process.cwd(), 'lib/src/Carburetor/Store/Carburetor.ts'), 'utf8');
        expect(subscriptions).toContain("process.env.NODE_ENV !== 'production'");
        expect(carburetor).toContain("process.env.NODE_ENV !== 'production'");
    });
});
