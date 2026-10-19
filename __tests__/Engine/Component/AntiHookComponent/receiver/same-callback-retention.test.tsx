import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {act} from 'react';
import {Carburetor, AntiHookComponent} from '@/Carburetor';
import {enableReactActEnvironment} from '../../../../reactActEnvironment';

enableReactActEnvironment();

class Store extends Carburetor<{flag: boolean; a: number; b: number}> {
    public change(): void {
        this.update(data => { data.flag = true; });
    }
}

describe('same-callback subscription retention', () => {
    test('does not notify after a synchronous branch-changing render', async () => {
        const store = new Store({flag: false, a: 1, b: 2});
        let renders = 0;
        let rendersAtXReturn = 0;
        class View extends AntiHookComponent<{revision: number}> {
            public render(): React.ReactNode {
                renders++;
                const data = this.useCarburetor(store);
                return <span>{data.flag ? data.a : data.b}</span>;
            }
        }
        const container = document.createElement('div');
        const root = createRoot(container);
        const id = store.subscribe(() => {
            flushSync(() => root.render(<View revision={1}/>));
            rendersAtXReturn = renders;
        });
        try {
            await act(async () => root.render(<View revision={0}/>));
            expect(renders).toBe(1);
            await act(async () => { store.change(); });
            expect(container.textContent).toBe('1');
            expect(rendersAtXReturn).toBe(2);
            expect(renders).toBe(rendersAtXReturn);
        } finally {
            store.unsubscribe(id);
            await act(async () => root.unmount());
            container.remove();
        }
    });
});
