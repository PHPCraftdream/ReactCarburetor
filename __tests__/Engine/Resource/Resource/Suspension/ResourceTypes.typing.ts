// Type-only checks for §2 of the resource handles plan: loader overloads infer TArgs, and
// `key` is contextually typed. Runtime behavior is covered by the ordinary suites.
import {IResourceCacheOptions, TResourceArgs, TResourceKey, TResourceLoader} from '@/Carburetor/Models/Resource';
import {ResourceCarburetor} from '@/Carburetor/Resource/ResourceCarburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

type TArgsOf<R> = R extends ResourceCarburetor<string, infer TArgs> ? TArgs : never;
type TCacheArgsOf<R> = R extends ResourceCache<string, infer TArgs> ? TArgs : never;

type TAssertEqual<TActual, TExpected> = [TActual] extends [TExpected]
    ? [TExpected] extends [TActual] ? true : never
    : never;

const signal = new AbortController().signal;

// (id: string, signal) → [id: string]
{
    const resource = new ResourceCarburetor(async (id: string, abort: AbortSignal) => {
        return `${id}:${String(abort !== signal)}`;
    });
    const check: TAssertEqual<TArgsOf<typeof resource>, [id: string]> = true;
    void check;
}

// (id: string, page: number, signal) → [string, number]
{
    const resource = new ResourceCache(async (id: string, page: number, abort: AbortSignal) => {
        return `${id}${page}${String(abort !== signal)}`;
    });
    const check: TAssertEqual<TCacheArgsOf<typeof resource>, [string, number]> = true;
    void check;
}

// (signal) → []
{
    const resource = new ResourceCarburetor(async (abort: AbortSignal) => String(abort !== signal));
    const reveal: [] = null as unknown as TArgsOf<typeof resource>;
    void reveal;
}

// () → []
{
    const resource = new ResourceCarburetor(async () => 'answer');
    const check: TAssertEqual<TArgsOf<typeof resource>, []> = true;
    void check;
}

// (id: string) without a signal → [id: string], via the second overload
{
    const resource = new ResourceCarburetor(async (id: string) => id);
    const check: TAssertEqual<TArgsOf<typeof resource>, [id: string]> = true;
    void check;
}

// Loader arguments must be fixed-length and required: the runtime appends the signal last, so an
// optional loader argument would swallow the signal of a bare load(). The TSignalLoader guard only
// bites when TArgs is inferred from the loader: a default `(id = 'x')` is rejected then, but
// optional/rest members are not rejected at all today, and with explicit generics even an optional
// member passes through the second permissive overload. The runtime still appends the signal after
// the loader arguments, so the safe spelling for an optional argument is `id: string | undefined`.
{
    // @ts-expect-error — default loader parameters are rejected (the signal follows the arguments)
    const withDefault = new ResourceCarburetor(async (id = 'x') => id);
    void withDefault;
}

// @ts-expect-error — default loader parameters are rejected for the cache too (inferred TArgs)
const cacheWithDefault = new ResourceCache(async (id = 'x') => id);
void cacheWithDefault;

// explicit generics bypass the guard: the permissive second overload accepts optional members; the
// runtime still appends the signal.
{
    const carburetor = new ResourceCarburetor<string, [id?: string]>(async (id = 'all') => id);
    const carburetorCheck: TAssertEqual<TArgsOf<typeof carburetor>, [id?: string]> = true;
    void carburetorCheck;
    const cache = new ResourceCache<string, [id?: string]>(async (id = 'all') => id);
    const cacheCheck: TAssertEqual<TCacheArgsOf<typeof cache>, [id?: string]> = true;
    void cacheCheck;
    const optionalCache = new ResourceCache<string, [id?: string]>(async (id?: string) => id ?? 'x');
    const optionalCheck: TAssertEqual<TCacheArgsOf<typeof optionalCache>, [id?: string]> = true;
    void optionalCheck;
}

// (id: string | undefined) is the escape hatch for an optional loader argument.
{
    const resource = new ResourceCarburetor(async (id: string | undefined) => id ?? 'all');
    const check: TAssertEqual<TArgsOf<typeof resource>, [id: string | undefined]> = true;
    void check;
    void resource.load(undefined);
}

// ── Negative call checks for every loader shape (§2): arity/type mismatches are errors ──

// Shape (id: string, signal): load('a') is fine; no id, an extra argument and a number id are errors.
{
    const resource = new ResourceCarburetor(async (id: string, abort: AbortSignal) =>
        `${id}:${String(abort !== signal)}`);
    void resource.load('a');
    // @ts-expect-error — load: wrong arity (no arguments at all)
    void resource.load();
    // @ts-expect-error — load: wrong arity (extra argument; the caller never passes the signal)
    void resource.load('a', 1);
    // @ts-expect-error — load: wrong argument type (number instead of string id)
    void resource.load(1);
}

// Shape (signal): load() is fine; load('a') is an error.
{
    const resource = new ResourceCarburetor(async (abort: AbortSignal) => String(abort !== signal));
    void resource.load();
    // @ts-expect-error — load: wrong arity (the loader takes no loader arguments)
    void resource.load('a');
}

// Shape (): load() is fine; load('a') is an error.
{
    const resource = new ResourceCarburetor(async () => 'answer');
    void resource.load();
    // @ts-expect-error — load: wrong arity (the loader takes no arguments)
    void resource.load('a');
}

// Shape (id: string) without a signal, via the second overload: load('a') is fine;
// load() and load(1) are errors.
{
    const resource = new ResourceCarburetor(async (id: string) => id);
    void resource.load('a');
    // @ts-expect-error — load: wrong arity (the id is required)
    void resource.load();
    // @ts-expect-error — load: wrong argument type (number instead of string id)
    void resource.load(1);
}

// Shape (id: string | undefined): load(undefined) and load('a') are fine; load(1) is an error.
{
    const resource = new ResourceCarburetor(async (id: string | undefined) => id ?? 'all');
    void resource.load(undefined);
    void resource.load('a');
    // @ts-expect-error — load: wrong argument type (number instead of string id)
    void resource.load(1);
}

// key is contextually typed from the loader arguments
{
    const options: IResourceCacheOptions<[string, number]> = {
        key: (id, page) => `${id}/${page}`,
    };
    // @ts-expect-error — key arguments must match the loader arguments
    const wrong: IResourceCacheOptions<[string]> = {key: (id: string, _page: number) => id};
    void options;
    void wrong;
}

// The standalone types compose: a loader union and a key over the same tuple.
{
    type TLoader = TResourceLoader<number, [id: string]>;
    const loader: TLoader = async (id, signal) => Number(id) + (signal ? 1 : 0);
    const key: TResourceKey<[id: string]> = (id) => id;
    const args: TResourceArgs = ['a'];
    void loader;
    void key;
    void args;
}

// ── Negative arity/type checks for every handle method (§2 + §7 of the plan) ──

const carburetor = new ResourceCarburetor(async (id: string, page: number, abort: AbortSignal) =>
    `${id}${page}${String(abort !== signal)}`);
const cache = new ResourceCache(async (id: string, page: number, abort: AbortSignal) =>
    `${id}${page}${String(abort !== signal)}`);

{
    void carburetor.load('a', 1);
    // @ts-expect-error — load: wrong arity (missing page)
    void carburetor.load('a');
    // @ts-expect-error — load: wrong argument type
    void carburetor.load(1, 1);
    void carburetor.refresh('a', 1);
    // @ts-expect-error — refresh: wrong arity
    void carburetor.refresh('a');
    // @ts-expect-error — refresh: wrong argument type
    void carburetor.refresh(true, 1);
    void carburetor.suspend('a', 1);
    // @ts-expect-error — suspend: wrong arity
    void carburetor.suspend();
    // @ts-expect-error — suspend: wrong argument type
    void carburetor.suspend('a', '1');
    void carburetor.abort();
    // @ts-expect-error — abort takes no arguments
    void carburetor.abort('a');
    // getEntry/invalidate/forget belong to the cache surface, not the carburetor slot:
    // @ts-expect-error — getEntry does not exist on ResourceCarburetor
    void carburetor.getEntry('a');
    // @ts-expect-error — invalidate does not exist on ResourceCarburetor
    void carburetor.invalidate('a');
    // @ts-expect-error — forget does not exist on ResourceCarburetor
    void carburetor.forget('a');
}

{
    void cache.load('a', 1);
    // @ts-expect-error — load: wrong arity
    void cache.load('a');
    // @ts-expect-error — load: wrong argument type
    void cache.load('a', '1');
    void cache.refresh('a', 1);
    // @ts-expect-error — refresh: wrong arity
    void cache.refresh();
    // @ts-expect-error — refresh: wrong argument type
    void cache.refresh('a', null);
    void cache.suspend('a', 1);
    // @ts-expect-error — suspend: wrong arity
    void cache.suspend('a');
    // @ts-expect-error — suspend: wrong argument type
    void cache.suspend(1, 1);
    void cache.getEntry('a', 1);
    // @ts-expect-error — getEntry: wrong arity
    void cache.getEntry('a');
    // @ts-expect-error — getEntry: wrong argument type
    void cache.getEntry(['a'], 1);
    void cache.invalidate('a', 1);
    // @ts-expect-error — invalidate: wrong arity
    void cache.invalidate();
    // @ts-expect-error — invalidate: wrong argument type
    void cache.invalidate(1, 1);
    void cache.forget('a', 1);
    // @ts-expect-error — forget: wrong argument type
    void cache.forget('a', '1');
    // @ts-expect-error — forget: wrong argument type
    void cache.forget(false, 1);
    void cache.abort('a', 1);
    // @ts-expect-error — abort: wrong arity
    void cache.abort('a');
    // @ts-expect-error — abort: wrong argument type
    void cache.abort(1, 1);
}

// `useResource` (component call) validates the argument tuple the same way.
declare const component: import('@/Carburetor').AntiHookComponent;
{
    void component.useResource(cache, 'a', 1);
    // @ts-expect-error — useResource: wrong arity
    void component.useResource(cache, 'a');
    // @ts-expect-error — useResource: wrong argument type
    void component.useResource(cache, 'a', '1');
}

// `key` is inferred contextually from the loader: no annotations inside `key` allowed.
{
    const keyed = new ResourceCarburetor(async (id: string, page: number, abort: AbortSignal) => {
        return `${id}${page}${String(abort !== signal)}`;
    }, {key: (id, page) => id + page});
    const check: TAssertEqual<TArgsOf<typeof keyed>, [string, number]> = true;
    void check;
    const keyedCache = new ResourceCache(async (id: string, page: number, abort: AbortSignal) => {
        return `${id}${page}${String(abort !== signal)}`;
    }, {key: (id, page) => `${id}#${page}`});
    const cacheCheck: TAssertEqual<TCacheArgsOf<typeof keyedCache>, [string, number]> = true;
    void cacheCheck;
    // @ts-expect-error — key arguments must match the inferred loader arguments
    new ResourceCarburetor(async (id: string, page: number, _abort: AbortSignal) => id + page,
        {key: (id: number) => String(id)});}
