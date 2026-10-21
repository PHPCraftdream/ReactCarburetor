/// <reference lib="esnext.disposable" />
import {ICarburetorToken} from '@/Carburetor/Models/Tooling';
import {CarburetorScope} from '@/Carburetor/Component/Scope/CarburetorScope';

/** Creates an isolated scope and optionally installs token overrides.
 *
 * @param overrides - token instances to install in the new scope
 */
export const createTestScope = (
    overrides?: Iterable<readonly [ICarburetorToken<unknown>, unknown]>
): CarburetorScope & {[Symbol.dispose](): void} => {
    const scope = new CarburetorScope();
    if (overrides) for (const [token, instance] of overrides) scope.set(token, instance);
    const disposeKey = Symbol.dispose;
    if (typeof disposeKey === 'symbol') {
        Object.defineProperty(scope, disposeKey, {value: (): void => scope.dispose()});
    }
    return scope as CarburetorScope & {[Symbol.dispose](): void};
};
