# Resource handles — implementation plan, 2026-10-15

Status: design settled, implementation in progress. Tasks: `RH-1` … `RH-8` (§10).
Owner decisions: handles are `load` / `refresh` / `clear`; loader arguments become variadic
`(...args, signal)` with exact type matching; key matching is configured when the resource is
created; D1–D4 in §9.

## 1. Goal

A resource exposes three handles and nothing else is needed to drive it from an event handler:

| handle | meaning |
|---|---|
| `load(...args)` | load only when nothing usable is stored for the key of `args` |
| `refresh(...args)` | always request, even when the key already has a value |
| `clear()` | cancel requests, drop stored answers, status back to Idle |

Acceptance:

- `new ResourceCarburetor(async (id: string, signal) => …)` infers `TArgs = [id: string]`;
  `load('a')` compiles, `load()` / `load(1)` / `load('a', 2)` do not. Same for `ResourceCache`,
  `useResource(source, ...args)`, `suspend`, `getEntry`, `invalidate`, `forget`, `abort`.
- A `key` option given at construction decides which calls share an answer; without it the
  default key equals today's key for 0- and 1-argument resources (snapshots and cache paths stay
  byte-identical).
- "Click shows another record" needs one store and one call: `user.load(id)` in a handler, the
  component reads `this.useCarburetor(user)` — no selection carburetor.

Non-goals: cursors, per-key function caches, new hooks, changes to status flags, a new lint rule.

## 2. Types

```ts
// Models/Resource.ts
export type TResourceArgs = readonly unknown[];
export type TResourceLoader<T, TArgs extends TResourceArgs> =
    | ((...args: [...TArgs, AbortSignal]) => Promise<T>)
    | ((...args: TArgs) => Promise<T>);
export type TResourceKey<TArgs extends TResourceArgs> = (...args: TArgs) => string | number;
```

Both constructors get two overloads, signal-taking first:

```ts
constructor(loader: (...args: [...TArgs, AbortSignal]) => Promise<T>, options?: IResourceOptions<TArgs>);
constructor(loader: (...args: TArgs) => Promise<T>, options?: IResourceOptions<TArgs>);
```

Verified with `tsc --strict` (throwaway probe, not committed):

- `(id: string, signal: AbortSignal)` → `[id: string]`; wrong type / arity rejected.
- `(id: string, page: number, signal)` → `[string, number]`; `(signal)` → `[]`; `()` → `[]`.
- `(id: string)` without a signal → `[id: string]` via the second overload (one overload alone fails
  here: TS matches `string` against `AbortSignal`).
- `(id?: string)` → `[id?: string]`.
- `key: (id, page) => …` is contextually typed from the loader.
- Known edge: a first parameter typed `unknown`/`any` is taken as the signal (`TArgs = []`).
  Documented; the fix is an explicit `new ResourceCarburetor<T, [unknown]>(…)`.

Runtime always calls `loader(...args, signal)`; a loader without the parameter ignores it.

`TArgs` changes from a single value to a tuple: `ResourceCache<User, string>` becomes
`ResourceCache<User, [id: string]>`; `TArgs = void` default becomes `[]`. Breaking, recorded in
CHANGELOG (0.1.0 is unpublished; no version bump).

## 3. Keys

Default key (both classes), chosen so existing keys do not move:

- `args.length === 0` → `JSON.stringify(null)` (today's `void`/`undefined` key);
- `args.length === 1` → today's rule on `args[0]` (cache keeps its primitive fast path and the
  `keyCacheSize` memo keyed by the single argument);
- `args.length >= 2` → `JSON.stringify(args)`; the reference memo does not apply (fresh array per
  call), the JSON-equality memo still does.

`key` option: `(...args) => string | number`, called once per handle call. Its result replaces the
JSON step; the cache then encodes it exactly as it encodes a JSON key today (`encodeCacheKey` /
`escapeCacheKey`), so path safety is unchanged. Validation: non-function → `TypeError` at
construction; a returned value that is not a finite number or string → `TypeError` at the call.

Trailing `undefined` arguments: `load('a')` and `load('a', undefined)` produce different default
keys (`"a"` vs `["a",null]`). Default key strips trailing `undefined` before choosing the branch, so
optional parameters do not split entries.

## 4. `ResourceCarburetor`

Constructor: `(loader, options?: {key?, ttl?, maxEntries?, scheduler?})`. The positional
`scheduler` argument moves into options (8 test/perf call sites). `ttl`/`maxEntries` validation and
defaults match `ResourceCache`.

The slot shows one current answer, and remembers earlier successful answers by key (D1):
a runtime-only map `key → {data, updatedAt}`, LRU-bounded by `maxEntries`, an entry usable while
`now - updatedAt < ttl` (no `ttl` → never stale). The memory is not part of the state, snapshot,
history or SSR payload; only the current answer is (as today).

- `load(...args)`: when the current answer has the key of `args`, is Success and not stale → no
  request. When the memory holds a fresh answer for that key → it becomes current synchronously
  (Success, its `data`/`updatedAt`, one publication), no request. Joins an in-flight request with
  the same key (as today). Otherwise (missing, stale, Error) → starts a request (D4).
- `refresh(...args)`: today's `[R.start](args, false, true)` — always restarts. `reload()` is
  removed; `refresh()` without arguments on a `[]` resource covers it, and for argument resources
  the caller passes the arguments (no hidden "last args" state to explain).
- A successful settle also writes the memory; `refresh` replaces the memory entry on success.
- `suspend(...args)` follows the same rule as `load` (memory hit → returns its data, publication
  deferred because it runs in render; stale → requests).
- `clear()`: cancel in flight, drop the answer and the whole memory, install the initial state (Idle, `data`
  undefined, `error` undefined, `updatedAt` undefined) in one publication. Differs from `abort()`,
  which keeps data.
- `suspend(...args)`, `abort()`, `getLastError()` keep their meaning with variadic arguments.
- Snapshot wire key is the computed key, so §3 keeps old snapshots restorable.

Rejected alternative: delegating the memory to an internal `ResourceCache` — two states and two
publication paths for one store.

## 5. `ResourceCache`

Already has `load` (missing/stale/invalidated → request) and `refresh`; gains `clear()`.

- Every argument-taking method becomes variadic: `load`, `refresh`, `suspend`, `getEntry`,
  `getFailure`, `resolve`, `invalidate`, `forget`, `abort`.
- `clear()` = `forgetAll()` semantics (cancel every request, drop every entry, one publication).
  `forgetAll()` is removed rather than kept as an alias (D3).
- Options gain `key`; `ttl`, `maxEntries`, `keyCacheSize` unchanged.
- `[R.primed]` (the one-shot resolution reuse between `resolve` and `useResource`) is keyed by the
  first argument today; for ≥2 arguments it is skipped (correctness first, the memo is a fast path).

## 6. Integration

- `IResourceSource<T, TArgs>`: `resolve(...args)`, `load(...args)`.
- `AntiHookComponent.useResource(source, ...args)`; the deferred-load closure stores the tuple.
- Interop: `useResourceValue(source, ...args)`, `createResourceReader` stores the tuple.
- SSR/hydration and history: keys only — covered by §3, re-verified by the existing suites.
- Native linter: `READ_METHODS` in `no_store_write_in_render.rs` is unaffected (`load`/`refresh`/
  `clear` are writes and stay reported in render). `clear` is in `MUTATING_METHODS`
  (`support/bases.rs`): check that `resource.clear()` in a handler is not reported by
  `no-external-data-mutation` (it only inspects data reads, but needs a fixture to prove it).

## 7. Event handlers

`load`, `refresh` and `clear` are bound to their instance on both classes (D2): they receive the
caller's arguments as-is, so `onClick={user.refresh}` is the intended form for a resource without
parameters. For a resource with parameters TypeScript rejects that assignment (`MouseEvent` is not
`string`), and the handler is a method that passes the arguments:

```tsx
class UserButton extends AntiHookComponent<{id: string}> {
    @bind
    private open(): void {
        void user.load(this.props.id);
    }
    …
}
```

For a `[]` resource the event still arrives at runtime as an extra argument, and the loader would
receive it in the signal position. The runtime cannot read the tuple length, so the handles drop
their incoming arguments when the first one is an event: a DOM `Event` instance, or an object whose
`nativeEvent` is one (React's synthetic event). That is the whole rule — no `loader.length`
guessing. Covered by tests for `onClick`, `addEventListener` and a direct `refresh()` call.

## 8. Migration

Mechanical, per area (counts of files touching resources): `lib/src` resource and interop modules,
81 test files under `__tests__/`, ~25 perf files, 22 example files, ~20 docs pages, README.
Generic arguments `<T, X>` → `<T, [X]>`; `reload()` → `refresh(args)`; `forgetAll()` → `clear()`;
`new ResourceCarburetor(loader, scheduler)` → `(loader, {scheduler})`. Call sites with one argument
are unchanged.

## 9. Decisions (owner, 2026-10-15)

- **D1** `ResourceCarburetor` remembers earlier answers by key while they are fresh by `ttl` (§4).
- **D2** Handles are bound and take the caller's arguments; binding one directly to an event is
  possible only for a resource without parameters, otherwise a method passes the arguments (§7).
- **D3** No aliases: `reload` and `forgetAll` are removed.
- **D4** Every handle and read path requests again for a stale entry (past `ttl`); without `ttl`
  nothing goes stale.

## 10. Tasks

- **RH-1** types and keys: `TResourceArgs`, loader union, overloads, default key with
  trailing-`undefined` stripping, `key` option and validation; type tests (positive and
  `@ts-expect-error`) for every row of §2.
- **RH-2** `ResourceCarburetor`: options object, `load` skip rule, `refresh`, `clear`, variadic
  `suspend`; remove `reload`. Blocked by RH-1.
- **RH-3** `ResourceCache`: variadic methods, `key` option, `clear` replacing `forgetAll`, `primed`
  rule for ≥2 args. Blocked by RH-1.
- **RH-4** integration: `IResourceSource`, `useResource`, interop hooks/reader. Blocked by RH-2, RH-3.
- **RH-5** migrate tests, perf scenarios, consumer fixture; full `npm test`, perf gates. Blocked by RH-4.
- **RH-6** linter: fixture proving `resource.clear()` is not a data mutation; rule docs where
  resource methods are named. Blocked by RH-4.
- **RH-7** docs: README "Cached resources" + resource section (handles table, click-to-switch
  example in `examples/`, key option, variadic types and the `unknown` edge), api-reference,
  promise-cache, CHANGELOG Breaking. Blocked by RH-5.
- **RH-8** review (rush reviewer) and CI fast + full. Blocked by RH-5, RH-6, RH-7.
