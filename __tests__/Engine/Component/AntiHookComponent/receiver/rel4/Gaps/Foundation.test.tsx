import {React} from '../../../support';
import {AntiHookComponent} from '@/Carburetor';

describe('Foundation render accessor gaps', () => {
    test('falls back to the prototype render after assigning a non-function', () => {
        class Text extends AntiHookComponent {
            public render(): React.ReactNode {
                return <span>prototype render</span>;
            }
        }

        const instance = new Text({});
        (instance as unknown as {render: unknown}).render = 'not a function';
        expect(typeof instance.render).toBe('function');
    });

    test('returns undefined from a non-function prototype render getter', () => {
        class UndefinedRender extends AntiHookComponent {
            public render(): React.ReactNode {
                return null;
            }
        }
        Object.defineProperty(UndefinedRender.prototype, 'render', {
            configurable: true,
            get: (): undefined => undefined,
        });

        const instance = new UndefinedRender({});
        expect((instance as unknown as {render: unknown}).render).toBeUndefined();
    });
});
