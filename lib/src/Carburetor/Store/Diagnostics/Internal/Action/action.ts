import {storeLifecycle} from "@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle";
import {updateBatch} from "@/Carburetor/Store/Transaction/UpdateBatchInstance";
import {warnIfAsyncMutate} from "@/Carburetor/Store/Diagnostics/warnIfAsyncMutate";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

declare const process: {env: {NODE_ENV?: string}};
type IActionStore = {draft: unknown; emitUpdate: () => void};
const actionDepth = new WeakMap<object, number>();

/** Batches synchronous writes from a store method.
 *
 * @param method - decorated method
 * @param context - Stage 3 method decorator context
 */
export const action = <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>
): ((this: This, ...args: Args) => Result) => {
    if (context.kind !== 'method') throw new Error('Carburetor: @action applies to methods.');
    if (context.private) throw new Error('Carburetor: @action cannot decorate private methods.');
    if (context.name === 'update') throw new Error('Carburetor: @action cannot decorate reserved update.');
    return function (this: This, ...args: Args): Result {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        const store = this as This & IActionStore;
        const depth = actionDepth.get(this) ?? 0;
        actionDepth.set(this, depth + 1);
        updateBatch.begin();
        try {
            void store.draft;
            const result = method.apply(this, args);
            if (process.env.NODE_ENV !== 'production') {
                warnIfAsyncMutate(result);
                if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
                    let then: unknown;
                    try {
                        then = (result as {then?: unknown}).then;
                    } catch {
                        then = undefined;
                    }
                    if (typeof then === 'function' && !(result instanceof Promise)) {
                        diagnostics.report(
                            '@action returned a thenable; actions must finish synchronously, so ' +
                                'writes after awaiting it are not published.'
                        );
                    }
                }
            }
            return result;
        } finally {
            try {
                if (depth === 0) store.emitUpdate();
            } finally {
                if (depth === 0) actionDepth.delete(this);
                else actionDepth.set(this, depth);
                updateBatch.end();
            }
        }
    };
};
