// Opt in only from tests that drive React roots directly rather than through RTL.
export const enableReactActEnvironment = (): void => {
    let previous: PropertyDescriptor | undefined;

    beforeAll(() => {
        previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
            configurable: true,
            writable: true,
            value: true,
        });
    });

    afterAll(() => {
        if (previous) {
            Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
        } else {
            Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        }
    });
};
