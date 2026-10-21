import * as React from 'react';
import {render} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {CarburetorChildScope, CarburetorContext, CarburetorScope, carburetorToken} from '@/Carburetor';

const Text = (): React.ReactElement => <span>server-child</span>;

describe('child scope React boundary', () => {
    test('SSR renders no children and allocates no scope', () => {
        const parent = new CarburetorScope();
        let factories = 0;
        const local = carburetorToken(() => { factories++; return {}; }, 'child-boundary/ssr');
        const html = renderToString(<CarburetorContext.Provider value={parent}>
            <CarburetorChildScope tokens={[local]}><Text/></CarburetorChildScope>
        </CarburetorContext.Provider>);
        expect(html).toBe('');
        expect(parent.has(local)).toBe(false);
        expect(factories).toBe(0);
    });

    test('mount and StrictMode remount own a fresh child scope then dispose on unmount', () => {
        const parent = new CarburetorScope();
        const dispose = rstest.fn();
        const local = carburetorToken(() => ({dispose}), 'cr2/react-owned');
        const Consumer = (): null => {
            const scope = React.useContext(CarburetorContext);
            if (scope) scope.get(local);
            return null;
        };
        const rendered = render(<CarburetorContext.Provider value={parent}>
            <React.StrictMode><CarburetorChildScope tokens={[local]}>
                <Consumer/>
            </CarburetorChildScope></React.StrictMode>
        </CarburetorContext.Provider>);
        expect(parent.has(local)).toBe(false);
        rendered.unmount();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    test('a changed parent scope rebuilds the child instead of keeping the old parent', () => {
        const parentA = new CarburetorScope();
        const parentB = new CarburetorScope();
        const shared = carburetorToken(() => ({owner: 'unset'}), 'cr2/parent-change/shared');
        parentA.get(shared).owner = 'A';
        parentB.get(shared).owner = 'B';
        const seen: string[] = [];
        const Consumer = (): null => {
            const scope = React.useContext(CarburetorContext);
            if (scope) seen.push(scope.get(shared).owner);
            return null;
        };
        const tree = (parent: CarburetorScope): React.ReactElement => <CarburetorContext.Provider value={parent}>
            <CarburetorChildScope tokens={[]}><Consumer/></CarburetorChildScope>
        </CarburetorContext.Provider>;
        const rendered = render(tree(parentA));
        expect(seen[seen.length - 1]).toBe('A');
        rendered.rerender(tree(parentB));
        expect(seen[seen.length - 1]).toBe('B');
        parentA.dispose();
        rendered.rerender(tree(parentB));
        expect(seen[seen.length - 1]).toBe('B');
        rendered.unmount();
    });
});
