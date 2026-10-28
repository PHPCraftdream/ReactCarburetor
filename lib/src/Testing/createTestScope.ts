/// <reference lib="esnext.disposable" preserve="true" />
import {ICarburetorToken} from '../Carburetor/Models/Tooling';
import {CarburetorScope} from '../Carburetor/Component/Scope/CarburetorScope';
import {ITestClock} from './ITestClock';

/**
 * Creates a test scope with optional overrides and clock.
 *
 * @param overrides - token instances to install in the new scope
 * @param options - optional clock, attached lazily; constructor-time timers of override instances are
 * re-homed onto the clock when the scope attaches it. Stores never placed in a scope (and never
 * clock.attach()ed) keep global timers.
 */
export const createTestScope = (
    overrides?: Iterable<readonly [ICarburetorToken<unknown>, unknown]>,
    options?: {clock?: ITestClock}
): CarburetorScope & {[Symbol.dispose](): void} => {
    const scope = new CarburetorScope();
    scope.useTestClock(options?.clock);
    if (overrides) for (const [token, instance] of overrides) scope.set(token, instance);
    const disposeKey = Symbol.dispose;
    if (typeof disposeKey === 'symbol') {
        Object.defineProperty(scope, disposeKey, {value: (): void => scope.dispose()});
    }
    return scope as CarburetorScope & {[Symbol.dispose](): void};
};
