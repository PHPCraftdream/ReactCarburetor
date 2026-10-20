import {AntiHookComponent, Carburetor, diagnostics} from '@/Carburetor';
import {render} from '@testing-library/react';

describe('wide read diagnostics', () => {
    test('enumerated values and entries warn while key enumeration stays silent', () => {
        const store = new Carburetor({a: 0, b: 0, c: 0});
        const valueErrors: unknown[] = [];
        const keyErrors: unknown[] = [];
        const original = console.error;
        class ValueReader extends AntiHookComponent {
            render() {
                const data = this.useCarburetor(store);
                return <span>{Object.values(data).join(',')}{Object.entries(data).length}</span>;
            }
        }
        class KeyReader extends AntiHookComponent {
            render() {
                const data = this.useCarburetor(store);
                return <span>{Object.keys(data).join(',')}</span>;
            }
        }
        diagnostics.setWideReadThreshold(2);
        console.error = (...args: unknown[]) => {
            valueErrors.push(args);
        };
        try {
            const values = render(<ValueReader/>);
            values.unmount();
            console.error = (...args: unknown[]) => {
                keyErrors.push(args);
            };
            const keys = render(<KeyReader/>);
            keys.unmount();
        } finally {
            console.error = original;
            diagnostics.setWideReadThreshold(Infinity);
        }
        expect(valueErrors.length).toBeGreaterThan(0);
        expect(keyErrors).toHaveLength(0);
    });
});
