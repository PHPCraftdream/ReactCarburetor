import {AntiHookComponent, Carburetor, diagnostics} from '@/Carburetor';
import {act} from 'react';
import {render} from '@testing-library/react';

describe('wide read diagnostics', () => {
    test('reports once per component/store for completed leaf reads', () => {
        const store = new Carburetor({a: 0, b: 0, c: 0});
        const errors: unknown[] = [];
        const original = console.error;
        class WideReader extends AntiHookComponent {
            public static displayName = 'WideReader';
            render() { const data = this.useCarburetor(store); return <span>{data.a + data.b + data.c}</span>; }
        }
        diagnostics.setWideReadThreshold(2);
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const view = render(<WideReader/>);
            act(() => { store.setData({a: 1, b: 0, c: 0}); });
            view.unmount();
        } finally { console.error = original; diagnostics.setWideReadThreshold(Infinity); }
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain('WideReader');
        expect(String(errors[0])).toContain(store.getUID());
    });

    test('does not warn at or below threshold and ignores unrelated store fields', () => {
        const store = new Carburetor({a: 0, b: 0, unrelated: {secret: 1}});
        const errors: unknown[] = [];
        const original = console.error;
        class NarrowReader extends AntiHookComponent {
            render() {
                const data = this.useCarburetor(store);
                return <span>{data.a + data.b}</span>;
            }
        }
        diagnostics.setWideReadThreshold(2);
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const view = render(<NarrowReader/>);
            act(() => { store.setData({a: 1, b: 1, unrelated: {secret: 2}}); });
            view.unmount();
        } finally {
            console.error = original;
            diagnostics.setWideReadThreshold(Infinity);
        }
        expect(errors).toHaveLength(0);
    });

    test('sums one store reads across two selections of one component', () => {
        const data: Record<string, number> = {};
        for (let i = 1; i <= 120; i++) data[`f${i}`] = 0;
        const store = new Carburetor(data);
        const errors: unknown[] = [];
        const original = console.error;
        class DoubleSelection extends AntiHookComponent {
            private readonly first = this.connectSelection(() => store, (d) => {
                let sum = 0;
                for (let i = 1; i <= 60; i++) sum += d[`f${i}`];
                return sum;
            });
            private readonly second = this.connectSelection(() => store, (d) => {
                let sum = 0;
                for (let i = 61; i <= 120; i++) sum += d[`f${i}`];
                return sum;
            });
            render() { return <span>{this.first() + this.second()}</span>; }
        }
        diagnostics.setWideReadThreshold(100);
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const view = render(<DoubleSelection/>);
            view.unmount();
        } finally {
            console.error = original;
            diagnostics.setWideReadThreshold(Infinity);
        }
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain('DoubleSelection');
        expect(String(errors[0])).toMatch(/12[0-9] paths/);
    });

    test('counts overlapping selections of one store once per path', () => {
        const data: Record<string, number> = {};
        for (let i = 1; i <= 60; i++) data[`f${i}`] = 0;
        const store = new Carburetor(data);
        const errors: unknown[] = [];
        const original = console.error;
        const sumAll = (d: Readonly<Record<string, number>>): number => {
            let sum = 0;
            for (let i = 1; i <= 60; i++) sum += d[`f${i}`];
            return sum;
        };
        class SameFields extends AntiHookComponent {
            private readonly first = this.connectSelection(() => store, sumAll);
            private readonly second = this.connectSelection(() => store, sumAll);
            render() { return <span>{this.first() + this.second()}</span>; }
        }
        diagnostics.setWideReadThreshold(100);
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const view = render(<SameFields/>);
            view.unmount();
        } finally {
            console.error = original;
            diagnostics.setWideReadThreshold(Infinity);
        }
        expect(errors).toHaveLength(0);
    });
});
