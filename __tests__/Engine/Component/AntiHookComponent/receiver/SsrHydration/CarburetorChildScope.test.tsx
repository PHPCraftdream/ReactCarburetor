import * as React from 'react';
import {render} from '@testing-library/react';
import {CarburetorChildScope, CarburetorContext, CarburetorProvider,
    CarburetorScope, ICarburetorToken, carburetorToken} from '@/Carburetor';

const Consumer = ({token}: {token?: ICarburetorToken<unknown>}): null => {
    const scope = React.useContext(CarburetorContext);
    if (scope === null) throw new Error('parent missing');
    if (token !== undefined) scope.get(token);
    return null;
};

describe('CarburetorChildScope', () => {
    test('stable under StrictMode and disposes its local values on unmount', () => {
        const parent = new CarburetorScope();
        const children: string[] = [];
        const token = carburetorToken(() => ({dispose: () => { children.push('done'); }}), 'scope-react/dispose');
        const rendered = render(
            <React.StrictMode><CarburetorChildScope tokens={[token]}><Consumer token={token}/>
            </CarburetorChildScope></React.StrictMode>, {
            wrapper: ({children}) => <CarburetorProvider scope={parent}>{children}</CarburetorProvider>,
        });
        rendered.unmount();
        expect(children).toEqual(['done']);
    });

    test('errors without a parent scope', () => {
        const error = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(() => render(<CarburetorChildScope tokens={[]}>
                <Consumer/>
            </CarburetorChildScope>)).toThrow(/parent scope/);
        } finally { error.mockRestore(); }
    });
});
