import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';
import {createWriteProxy} from '@/Carburetor/Store/Tracking/createWriteProxy';

/**
 * Runs `run` with the global `Proxy` constructor wrapped so every `new Proxy(target, handler)`
 * call it makes is observed, and returns the handler objects in call order. `Proxy` itself has
 * no `.prototype` to subclass, so the spy is a plain function that forwards construction
 * through `Reflect.construct` and returns the real proxy — the only shape `new` will accept
 * back from a constructor call.
 *
 * @param run - the code to run with `Proxy` observed; restored in a `finally` no matter what
 * `run` does.
 */
const captureProxyHandlers = (run: () => void): object[] => {
    const OriginalProxy = globalThis.Proxy;
    const handlers: object[] = [];

    function SpyProxy(target: object, handler: object): object {
        handlers.push(handler);

        return Reflect.construct(OriginalProxy, [target, handler]);
    }

    globalThis.Proxy = SpyProxy as unknown as ProxyConstructor;

    try {
        run();
    } finally {
        globalThis.Proxy = OriginalProxy;
    }

    return handlers;
};

describe('a proxy handler is one small instance per proxy, sharing its trap functions', () => {
    test('two read proxies get distinct handler instances with the same trap functions', () => {
        const handlers = captureProxyHandlers(() => {
            createReadProxy({a: 1}, () => undefined);
            createReadProxy({b: 2}, () => undefined);
        });

        expect(handlers.length).toEqual(2);

        const [handlerA, handlerB] = handlers as Array<Record<string, unknown>>;

        // One instance per proxy — its per-branch state (basePath, cache, ...) cannot be shared.
        expect(handlerA).not.toBe(handlerB);

        // The trap functions themselves live on the shared prototype, not rebuilt per proxy.
        expect(handlerA.get).toBe(handlerB.get);
        expect(handlerA.has).toBe(handlerB.has);
        expect(handlerA.ownKeys).toBe(handlerB.ownKeys);
        expect(handlerA.getOwnPropertyDescriptor).toBe(handlerB.getOwnPropertyDescriptor);
        expect(handlerA.set).toBe(handlerB.set);
        expect(handlerA.defineProperty).toBe(handlerB.defineProperty);
        expect(handlerA.deleteProperty).toBe(handlerB.deleteProperty);
        expect(handlerA.setPrototypeOf).toBe(handlerB.setPrototypeOf);
        expect(handlerA.preventExtensions).toBe(handlerB.preventExtensions);
    });

    test('two write proxies get distinct handler instances with the same trap functions', () => {
        const handlers = captureProxyHandlers(() => {
            createWriteProxy({a: 1}, () => undefined);
            createWriteProxy({b: 2}, () => undefined);
        });

        expect(handlers.length).toEqual(2);

        const [handlerA, handlerB] = handlers as Array<Record<string, unknown>>;

        expect(handlerA).not.toBe(handlerB);

        expect(handlerA.get).toBe(handlerB.get);
        expect(handlerA.set).toBe(handlerB.set);
        expect(handlerA.defineProperty).toBe(handlerB.defineProperty);
        expect(handlerA.deleteProperty).toBe(handlerB.deleteProperty);
    });
});
