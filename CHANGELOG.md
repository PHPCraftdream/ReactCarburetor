# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Carburetor.serialize(): string`: an explicit JSON persistence contract. Ordinary stores
  stringify live state without cloning; resource stores include their settled argument key.
  Custom persisted representations override `serialize` and restore the matching parsed shape.

- `persist(store, {coalesce: true})`: one `JSON.stringify` per microtask instead of one per write
  (0.94–1.44 ms per keystroke at 4000 items). Off by default, so a write still lands in storage
  before the call that caused it returns; the disposer flushes a pending write.

- `computed(body, {equals})`: a comparator that judges a recomputed result by content, so a
  body that builds a new array or object (`filter`, `map`, a literal) re-renders nobody when the
  content is unchanged. It runs only when the reference changed; an exotic result mutated in
  place still announces. `{equals: shallowEqual}` covers arrays of ids.
- A development diagnostic when a component renders through a computed's live result without
  subscribing to it — the result reached it through props. README: "Derived lists".
- `"use client"` on the modules that touch React's client API — the `AntiHookComponent` chain,
  `ScopedAntiHookComponent`, `CarburetorContext`, `CarburetorProvider` and both interop hooks — in
  all four builds, so a React Server Component can import the package without evaluating
  `createContext`/`React.Component` against `react-server`. Stores, caches, scopes and tooling stay
  directive-free and importable on the server. The production builds keep directives through the
  minifier, and the CJS builds no longer emit the unused `import.meta.url` shim, which was placed
  ahead of the directive. The consumer matrix builds a Next.js App Router app with Turbopack and
  webpack. See `docs/react-compatibility.md`.
- `@types/react` is now an optional peer dependency (`^18.0.0 || ^19.0.0`): a TypeScript
  consumer sees a warning on a real version mismatch, a plain-JS consumer sees nothing.
- A consumer matrix (`npm run test:consumers`) packs the library and installs it into fresh npm
  and pnpm projects across React 18/19 and ESM/CJS, typechecking and rendering a fixture
  against each; a CI job runs it on every push. See `docs/react-compatibility.md`.
- `AntiHookComponent.connect(source)`: a persistent view of a carburetor, built once (a field
  initializer is the intended call site) and read directly in render, instead of a fresh
  read-tracking proxy on every `useCarburetor` call. `source` is a carburetor or a function
  resolving one, so a prop swap re-points the connection; `setData`/`restore` keep the same
  returned view live across a whole-data replacement. Reads are still tracked field by field
  every render, so a conditional branch reading a different field still narrows or widens the
  subscription correctly — only the object identity and its underlying proxy are reused.
- `AntiHookComponent.connectSelection(source, select)`: the supported way to hand connected data to
  a child gated by shallow props comparison. Declared once like `connect` and called in render; the
  selector's reads subscribe the owner, and its plain objects/arrays and ordinary Map/Set/Date values
  are detached with descriptors and aliases intact. Plain selection content is compared recursively;
  opaque custom instances remain live and conservatively changed. Safely copied plain views do not
  warn; a live opaque facade escaping into the selection is reported in development.
- `Carburetor.update(mutate)`: mutates through `draft` and publishes in one step, so a write
  cannot be left unpublished. A draft write that never reaches `emitUpdate` is reported in
  development, and `emitSoon()` covers the case where notifying immediately is unsafe.
- Per-effect cleanup: `useEffect(callback, name, deps)` takes a dependency array and treats the
  callback's return value as that effect's cleanup, run before the effect re-runs and on unmount.
- A props/state gate on `AntiHookComponent`: a parent re-render no longer cascades into children
  whose props did not change, the bail-out `React.memo` gives function components. Exported
  `shallowEqual` is the comparator.
- `CarburetorScope.dehydrate()` / `hydrate(state, tokens)`: the server serializes every store the
  scope created and the client starts from the same data.
- `SubscriberIndex`: read paths and their ancestors are indexed, so a write looks up the
  subscribers it concerns instead of scanning all of them.
- `ResourceCache`: many async answers keyed by the arguments that produced them, with a lifetime per
  entry, request deduplication, abort, explicit invalidation and a bound on how many are kept. Reads
  are path-precise, so one entry answering does not re-render a component reading another. A failed
  refresh keeps the last good answer instead of replacing it with an error, and refreshing an entry
  that has data does not flash `Pending` over it. `AntiHookComponent.useResource` subscribes a
  component to one entry and refetches a stale one after the commit rather than during render;
  `suspend(args)` works per entry. Keys are escaped, because an unescaped one containing the path
  separator made two unrelated entries wake each other — see `docs/promise-cache.md`.
- `@bind`: a standard (Stage 3) decorator that binds a method once per instance. The method
  stays on the prototype, so `super` and overriding keep working — unlike an arrow class
  property — and the reference stays stable across renders, which is what the props gate needs:
  a handler built in render makes a child's props compare as changed every time. Requires no
  `experimentalDecorators`.
- `react-carburetor/lint`: 24 lint rules for the ways consumer code can go wrong silently — a write
  that reaches no subscriber, a component reading state it never subscribed to, an effect whose
  cleanup is dropped, a computed that never invalidates, an allocation rebuilt for nothing. One
  plugin serves both hosts, since oxlint's JS plugin API is ESLint's: oxlint consumers add one
  `extends` line pointing at the shipped `recommended.oxlintrc.json`, ESLint v9 consumers spread
  `carburetor.configs.recommended` into a flat config.
- `require-method-for-closure` and `require-module-function`: two `warn` rules for avoidable
  allocations in component classes — a closure inside a member that only the class could supply,
  rebuilt on every call of the member, and a closure or member that uses nothing from the class and
  belongs at module level. Eligible `#private` method and arrow-field reports from
  `require-module-function` carry an autofix (`--fix`) that moves the function above the class and
  rewrites `this.#name` references. Public/protected members, overloads, function-expression fields,
  explicit `this` parameters, and unsafe-to-rewrite references are report-only; closure reports and
  `require-method-for-closure` have none, because callback parameter annotations cannot be inferred.
- A native Rust port of all 24 rules (`native/`), and the JavaScript plugin rewritten into a thin
  bridge that calls it: the whole set of rules now has one implementation, not a JavaScript one and
  a native one kept in sync by hand. An earlier 22-rule benchmark recorded 20 ms for the native
  pass versus 270 ms for the JavaScript rule layer; current 24-rule timings are in `native/README.md`.
  The bridge spawns the binary exactly once per lint run and shares that one result across every rule
  and every file,
  including under ESLint's `--concurrency`, where several worker threads coordinate through a lock
  file in the OS temp directory rather than each spawning their own copy. Every rule keeps
  reporting through the host it always did — suppression comments, editor diagnostics and per-rule
  severity all still work, because the bridge only tells a rule which of its own findings exist; it
  never decides whether or how loudly to report them. A conformance suite runs both the native
  binary and the (now retired) reference behaviour over one shared fixture corpus and requires
  identical output, file by file, line by line, rule by rule.
- House style rules in the unpublished plugin, on for the whole repository: `max-line-length`
  (120 columns, a tab counted to its tab stop), `require-tsdoc`, `no-blank-line-after-tsdoc` and
  `tsdoc-blank-line-before-tags` (exactly one blank line between a description and its first
  block tag), the last two fixing themselves under `oxlint --fix`. `max-line-length` ignores string literals by default,
  because the demo's long lines are Tailwind class lists that are worse wrapped, and
  `require-tsdoc` measures only the summary paragraph, so the rationale below it stays free to be
  as long as it needs to be. Every function, method and function-valued property in the library,
  the demo and the plugins now carries a doc comment.
- `native/`: the configuration, suppression and output layer of the native linter. A
  `.carburetorrc.json` with per-rule severities and ignore patterns, whose defaults mirror
  `plugin/src/recommended.mts` — a test compares the two tables, since one product with two
  strictness levels would be two products. `carburetor-disable[-next-line]` directives, and
  oxlint's spellings honoured identically so one comment silences a rule in both linters. Human
  and `--format=json` output, and exit codes that distinguish "problems found" (1) from "the
  linter itself failed" (2). A rule set to `off` never runs rather than being filtered out
  afterwards.
- `carburetor-lint --fix` / `--fix-dry-run`: a rule may attach a fix to a diagnostic, which `--fix`
  applies and `--fix-dry-run` previews as a diff without writing. Two fixes overlapping in one file
  keep whichever starts first and leave the other for a later pass, and the file is re-parsed and
  re-checked after every change (up to ten passes) so a fix that does not resolve its own violation
  cannot hang the tool, and one that would leave the file unable to parse is discarded rather than
  published. Writing goes through a temporary file and a single rename, so a process killed
  mid-write leaves the original untouched. `no-lifecycle-class-property` is the first rule with a
  fix: a plain `name = () => body` property becomes `name() body`, carrying over whatever
  accessibility, `override`, `async`, generics or return type the arrow already had.
- `docs/hazards.md`: the catalogue behind those rules — for each hazard, the code that triggers it,
  why it is silent at runtime, the supported form, what the rule matches on, and where it can produce
  a false positive.
- `diagnostics` / `Diagnostics`: development-only warnings with an explicit on/off switch.
- `benchmarks/pathsIntersect.mjs`, run against the built output and kept out of the test suite.
- Pre-stripped production outputs (`dist/esm-prod`, `dist/cjs-prod`) selected by the `production`
  condition in `exports`, for toolchains that do not substitute `NODE_ENV` themselves.

- `computed(body)`: a memoized derived value that tracks the paths its body reads, recomputes
  only when one of them is written, and wakes subscribers only when the result changed.
  `AntiHookComponent.useComputed` subscribes a component to the value rather than its inputs.
- `transaction(body)`: writes made inside it are delivered as one update per carburetor,
  however many stores were touched.
- `snapshot()` / `restore()` and a type-erased `toJSON()` / `fromJSON()` bridge, plus
  `watch(paths, callback)` for subscribing outside React.
- `ResourceCarburetor`: async state with an explicit status, request deduplication, abort via
  `AbortSignal`, a serializable error message and `suspend()` for Suspense — class components
  do suspend on a thrown promise, which the test suite pins down.
- Per-request stores: `CarburetorScope`, `carburetorToken`, `CarburetorProvider` and
  `ScopedAntiHookComponent`, which resolves its carburetors through `contextType`, so server
  rendering no longer has to rely on module singletons.
- Tooling: `connectDevTools` (Redux DevTools protocol with time travel, injectable connector),
  `persist` (injectable storage), `CarburetorHistory` (undo/redo over snapshots) and
  `waitForUpdate` for tests.
- Optional `react-carburetor/interop` entry point with `useCarburetorValue` and
  `useComputedValue`, for embedding a carburetor into a hooks-based subtree. Built on
  `useSyncExternalStore`, and it derives the subscription from the selector's read paths.
- ESM output alongside CommonJS, with an `exports` map carrying per-condition types.

- Path-level tracking: `useCarburetor` returns tracked data, and a component subscribes to
  exactly the fields it read. `emitUpdate` wakes only the subscribers whose read paths
  intersect the written ones.
- `draft` write proxy on `Carburetor`, which records changed paths. Writes of an unchanged
  value record nothing and wake nobody.
- `IUpdateScheduler` with two policies: `SyncUpdateScheduler` (default, immediate delivery)
  and `ComponentUpdateThrottle(ms)` for streaming sources. The scheduler is chosen per
  carburetor instead of being global.
- `Carburetor.getVersion()`, used by components to detect a write that landed between render
  and commit.
- Dual licensing under MIT OR Apache-2.0.

### Changed

- **Breaking:** store state is now defined as own enumerable string-keyed data (an array's is its
  elements and `length`). Symbol keys, getters and setters, non-enumerable properties and non-index
  keys on an array are rejected: development throws at the constructor, `setData`, `restore` and
  `draft` writes; a symbol key or a non-data `defineProperty` through `draft` throws in every
  build. Symbol keys no longer widen a write to the whole store, `deepClone` no longer copies
  them, and `snapshot()`/`restore()` no longer lose or wake on what diffing could not see.
  Migrate to a string key, a `Map` or class instance, or a `computed`. `deepClone` of a row is
  about 2× faster and `snapshot()` of 4000 rows about 1.9× faster.
- `subscribe(callback, {reads})` copies `reads`, as its documentation always promised: changing the
  set afterwards no longer desynchronizes the index, and a `ReadonlySet` that is not a `Set` works
  with `extend`. The engine's own callers hand their sets over without a copy, so mounting is
  unchanged.
- **Breaking:** `watch(callback, reads?)` is now `watch(select, onChange)`: `select` runs against
  a tracked read of the data, its reads become the subscription, and `onChange(next, previous)`
  runs only when the selection changed (compared like `connectSelection`). For every write, use
  `subscribe(callback)` and `unsubscribe(id)`.
- **Breaking:** `TPath`, `TPathSet`, `TPathRecorder`, `WILDCARD_PATH` and `TAliasLedger` are no
  longer exported. `subscribe(callback, {reads})` and `read(record)` stay as the engine's
  extension contract, typed with `ReadonlySet<string>` and `string`; the path grammar is not a
  stable user-facing API.
- **Breaking:** `IResourceSource` is `resolve(args) → {key, path, view}` plus `load(args)` instead
  of six members. `ResourceCache` keeps `keyOf`, `pathOf`, `pathOfKey`, `getEntry` and
  `getEntryByKey` as its own methods.
- **Breaking:** `fromJSON(value)` adopts `value` instead of copying it: hand it freshly parsed
  JSON. `restore` still copies; resource stores keep hydrating through their `restore`.
- **Breaking:** `CarburetorHistory` takes `ICarburetor<T> & IPatchSource`: every `Carburetor`
  qualifies. `attachPatchListener` takes `{patch, publication?, ownRestore?}`, not a function;
  hand-written sources must honor requested pre-subscriber publication and exact restore-owned
  installation callbacks. Patch-only callers pass `{patch}`.
- **Performance:** `CarburetorHistory` records the patches behind each change instead of a deep
  copy of the state: one title write at 4000 items went from 3.9–5.1 ms to ~0.01 ms, and 50 entries
  retain 0.5 MB instead of 20.5 MB. A change the write proxy cannot describe still records a full
  copy either side of it. Undo and redo install through `restore`, so they wake only what they
  change and a store overriding `restore` (a `ResourceCache` aborting in-flight requests) keeps
  working.
- **Performance:** enumerating a branch (`Object.keys`, `values`, `entries`, `for…in`, spread)
  subscribes to its key set, not to every leaf below it, and at the root no longer to every write
  in the store. A list parent laying out rows from `Object.keys(items)` is no longer re-rendered by
  a title edit: 5.0–13.6 ms → 0.36–0.48 ms per edit at 4000 rows.
- **Performance:** `setData`, `restore`, `fromJSON`, undo and redo announce a structural diff
  instead of waking every subscriber, and replacing an object or array through `draft` records only
  the leaves that differ. Undoing one title edit at 4000 rows re-renders 1 row instead of 4000;
  `setData` with an equal copy re-renders nobody (209 ms → 7 ms); a title keystroke written as an
  object replacement no longer recomputes a filter reading only `done` (30.7 ms → 0.7 ms).
  `setData` keeps `getData() === data`; `restore` copies only what it assigns, so untouched
  branches keep their identity. A presence check (`'k' in items`) is no longer woken by a
  replacement of the same kind.
- **Performance:** the commit-time drift check compares the store's recent writes with the paths
  the render read instead of the store version, so a write elsewhere in the store between a render
  and its commit costs no second render: mounting 4000 rows next to a sibling that writes on mount
  renders 4000 rows instead of 8000.
- **Performance:** `ResourceCache` keeps an entry count and an LRU-ordered ledger instead of
  counting, filtering and sorting every entry on every fetch and every answer (O(N²) over a list of
  resource rows): 4000 resource rows settle in 1.6 s instead of 8.1 s at the default `maxEntries`.
- **Performance:** computed invalidation marks each stale node once: a write through a 26-node
  ladder of diamonds made ~950,000 marks and now makes 48 (58–77 ms → 0.1 ms). A recompute reads a
  published flag instead of a lookup per path and decides read-set equality while recording.
- **Performance:** fewer allocations per operation — `connect()` keeps its per-render source and
  entry on the connection instead of two Maps per render, facades share one empty target, commit
  and unmount run plain loops, `SubscriberIndex` files each read set once (no second owned copy)
  and matches without arrays or closures, `shallowEqual` compares two arrays by length and index
  (~10× faster on 4000 ids), `sameSelection` allocates its WeakMaps only for containers, and
  failure lists are allocated on the first failure.

- **Breaking:** `ComponentUpdateThrottle`, `CarburetorScope`, `CarburetorHistory` and
  `Diagnostics` members are prototype methods instead of arrow-function fields, like the stores
  below, so a subclass override written as a method is reached. Detached calls
  (`onClick={history.undo}`, `const {get} = scope`) must bind or wrap in an arrow.
- **Breaking:** `extend(id, path)` moved from `ICarburetorSubscription` to `ICarburetor`. Only
  stores implement it; a custom subscription source no longer has to, and `Computed` no longer
  carries a no-op.
- **Performance:** a symbol read records nothing. Writes through symbols already wake every
  subscriber, so `concat`, `Object.prototype.toString`, `String(obj)` and React's development
  prop logging no longer subscribe a reader to every write in the store.
- **Performance:** a read set that moves by one path re-registers only that path
  (`SubscriberIndex` diffs against what it filed): 1.1 ms → 0.08 ms per re-subscribe at 1000
  paths. Single-subscriber index buckets hold the bare id, and the per-subscriber ancestor cache
  is gone: index bookkeeping fell from about 2.2 KB to 0.6 KB per three-path subscriber.
- **Performance:** a `connect()` declaration keeps its state in one object and its facade traps on
  a shared handler prototype. Components allocate `tracked` and `effects` on first use, update
  commit slots in place, and release a consumed render attempt's collections. Read handlers
  memoize child paths, the write proxy builds a path only when it records one, and a proxy-cache
  hit allocates nothing.
- **Breaking:** store, cache and computed members (`getData`, `read`, `subscribe`, `watch`,
  `setData`, `preEmit`, `emitUpdate`, …) are prototype methods instead of arrow-function fields,
  so a subclass can override them with method syntax and call `super`. Code that detaches a
  store method without binding it (`const {getData} = store`, `onClick={store.load}`) must bind
  it or wrap it in an arrow.
- **Performance:** writes wake only the components they concern.
  - An index or `length` write on an array records that key: `push` no longer re-renders every
    existing row, and replacing `items[5]` re-renders one row.
  - A presence check (`has`, which `map`/`forEach`/`filter` run per index) records the element's
    branch marker, so a parent rendering `items.map(...)` is not woken by an edit inside a row.
  - Inherited keys (`Symbol.iterator`, `map`, `constructor`) record nothing, so `for…of`, spread
    and destructuring no longer subscribe a component to every write in the store.
- **Performance:** a consumer reading leaves off a computed's live result amends the dependency
  one path at a time (`Carburetor.extend`, `SubscriberIndex.addPath`) instead of re-subscribing
  the whole read set per leaf; a list re-render through a computed was O(N²) (4.4 s for one
  edit at 1000 rows).
- **Performance:** `AntiHookComponent` instances keep fast properties: the `render` accessor is
  one shared getter/setter pair instead of a closure pair per instance, which put every
  instance after the first into dictionary mode.
- **Performance:** read and write proxies share their traps on a handler prototype (one small
  handler per proxy instead of eight closures); render attempts allocate their collections on
  first use and key them by object; `useCarburetorValue` keeps one root read view per hook;
  `subscribe()` adopts its read set (`watch()` still copies); cache eviction asks the index for readers instead of scanning every subscriber.
- **Breaking:** `SubscriberIndex`, `pathsIntersect`, `getUid`, `isTrackable`, `SyncUpdateScheduler`
  and its `syncUpdateScheduler` instance are no longer exported from the package entry point.
  They were building blocks that never needed a semver contract of their own; they stay inside
  the engine, reachable only through internal import paths for code that lives in this repo.
- **Breaking:** `AntiHookComponent.useEffect` now takes `(name, callBack, deps)`, matching
  `subscribe(callback, options)`'s callback-first order instead of putting it last.
- **Breaking:** `Carburetor.watch` now takes `(callback, reads?)`, the same argument order as
  `subscribe(callback, options)`; `reads` is optional and defaults to every write (the wildcard
  path), so `watch(callback)` replaces `watch(new Set([WILDCARD_PATH]), callback)`.
- **Breaking:** `carburetorToken` no longer throws when a name is already claimed — an HMR
  reload re-declares the same token, and throwing turned every edit into a crash. Development
  reports the collision once via `diagnostics.report` and still returns a working token, built
  from the factory just given, so a scope that has not instantiated that id yet picks up the
  reloaded factory. An empty name is still rejected with a thrown error.
- **Performance:** several small render/write-path allocations removed: attempt-map keys are
  computed once instead of re-concatenated per read; a commit adopts its render attempt's read
  set as the committed subscription description instead of copying it (the set is provably
  immutable once the attempt closes); `emitUpdate`/`UpdateBatch` hand off the writes `Set` by
  reference instead of copying it; `ResourceCache.getEntry` returns one shared frozen view for
  every cache miss instead of a fresh object per call; `useResource` derives its cache key once
  per render instead of serializing the arguments twice (once for the read path, once for the
  entry); `escapeCacheKey` skips its escape pass when the key holds neither `~` nor `.`. `IResourceSource` gains `keyOf`,
  `pathOfKey` and `getEntryByKey`; a custom implementation must add them.
- **Performance:** `useCarburetor` now keeps one persistent root read view per (component
  instance, carburetor), reused across renders while the carburetor's `getData()` object stays
  the same, instead of allocating a fresh read-tracking proxy on every call — the same steady-state
  reuse `connect()` already gave a declared view. Rebuilds only on `setData`/`restore` or a
  different carburetor; a non-trackable root (`isTrackable` false) is unaffected, since `read()`
  never builds a proxy for one anyway. The per-carburetor cache is a `WeakMap`, created lazily on
  a component's first `useCarburetor` call, so a `connect()`-only component pays nothing for it.
  Measured with `benchmarks/useCarburetorProxy.mjs`: a cache hit reading one field costs ~0.0003
  ms/op against ~0.0010-0.0011 ms/op for a fresh proxy — roughly 3-4x faster in the common
  few-fields-per-render case; the gain narrows as the number of fields read per render grows,
  since the read work itself then dominates the one avoided allocation.
- **Breaking:** a class-field `render` (`render = () => ...`) is no longer supported.
  `AntiHookComponentFoundation`'s constructor installs `render` as a non-configurable own
  accessor, so a subclass's class-field `render` throws a `TypeError` at construction instead of
  being silently accepted. Declare `render` as a method; `no-lifecycle-class-property` (H13)
  flags a class-field `render` at lint time with an actionable message. Assigning `this.render =
  fn` from a constructor body is still supported.
- **Performance:** `AntiHookComponent` no longer wraps each instance in a `Proxy` to intercept
  `render`. The render-attempt boundary is installed once, as a non-configurable accessor for
  `render` alone, so every other property read or write — props, state, user fields — is a plain,
  untrapped access again. `useCarburetor`, `connect`, `connectSelection`, `declareConnection`,
  `useComputed`, `useResource`, `useEffect`, `reportTeardownFailure` and `runTeardownStage` moved
  from per-instance arrow-function fields to prototype methods, so a component no longer allocates
  nine closures per instance; `onCarburetorUpdate` stays a bound field, since it is passed to
  `subscribe()` as a callback.
- `Computed` keeps its subscribers in a `Map`: `get()` no longer allocates the subscriber id list
  on every call, so S components re-rendering from one computed cost O(S) instead of O(S²)
  (4000 subscribers: ~8.6 s to ~3.5 ms per five write-and-read waves).
- `persist()` writes `JSON.stringify(carburetor.getData())` instead of stringifying a
  `snapshot()` deep clone: `JSON.stringify` never mutates its input, so the clone was pure
  overhead. `deepClone` now copies keys by plain assignment instead of `Object.defineProperty`
  per key (falling back to `defineProperty` only for an own key literally named `__proto__`) and
  walks `Reflect.ownKeys` directly instead of building a filtered array first. Measured on a
  1000-row store: the persist write dropped from ~7.3 ms to ~1.2 ms per call, and `deepClone`
  itself from ~9.4 ms to ~2.6 ms.
- `useCarburetorValue()`'s default `isEqual` is now the same structural comparison
  `connectSelection()` uses — own data properties and `Object.is` values, recursively through
  plain objects and arrays — instead of `Object.is`. Every selected object is detached into a
  fresh container, so `Object.is` could never call two of them equal: an inline selector rebuilt
  every render, or a write that replaced an ancestor of the selected data without changing its
  content, always re-rendered. A `Map`, `Set`, `Date` or class instance still always compares as
  changed. Pass `Object.is` explicitly for the previous behavior. The default comparison runs
  before the selected value is detached, so a match skips the copy; a custom `isEqual` still
  receives detached values.
- The demo app uses the library's whole feature set where an app would need it: stores resolved
  from a `CarburetorScope`, the list loaded through a `ResourceCarburetor` with cancel and reload,
  per-todo details in a `ResourceCache`, a filter with computed visible ids, a
  `connectSelection()` stats child behind the props gate, bulk actions in a `transaction`,
  undo/redo, a persisted filter, a throttled status store and a hooks-interop badge.
- The internal lint rules' `RuleTester` suites run from one test file: each `RuleTester` process
  reserves a ~6 GB buffer, and one worker per rule file intermittently failed that allocation.
- `carburetorToken(create, name)`: a token's `id` is a caller-chosen name instead of a number
  from the process-local counter shared with stores and components. `CarburetorScope.dehydrate()`
  keys its payload by it and `hydrate()` matches on it across the server/client boundary, which a
  counter could not guarantee: any carburetor, component or token created before this one in one
  bundle but not the other shifted every later id, and the client silently hydrated from defaults.
  Two tokens claiming one name in a process are rejected, and `hydrate()` reports payload keys no
  token claims in development — a subset hydration stays silent and legitimate in production.
- `subscribe(callback, options)` takes an options object instead of positional `customId` and
  `reads`, and copies the read set it is given.
- `Carburetor<T extends object>`: a primitive store silently degraded to wildcard tracking.
- The public entry point exports a curated surface; the tracking proxies, proxy cache, path
  string plumbing and batch coordinator are no longer exported, and a test pins the surface.
- Internal imports no longer reach up out of their directory: `../../Models/Paths` is now
  `@/Carburetor/Models/Paths`, an alias resolved by TypeScript, Rstest and both bundlers, and
  rewritten to a relative path in every published output — JavaScript and declarations alike, which
  a build check confirms. An unpublished lint rule enforces the direction and rewrites offenders
  under `oxlint --fix`. Consumers see no change.
- The scope pieces (`CarburetorScope`, `carburetorToken`, `CarburetorProvider`,
  `CarburetorContext`) moved into `Component/Scope/`. Import paths inside the package changed;
  the published entry points did not.
- Sources are laid out one export per file, with related types grouped in `Models/` and at
  most seven entries per directory. The engine now reads as `Models/`, `Store/`, `Derived/`,
  `Resource/`, `Component/` and `Tooling/`. The published entry points are unchanged.
- Closed sets of values are enums rather than unions of string literals: `EResourceStatus`
  replaces `TResourceStatus`, and the Redux DevTools protocol strings became
  `EDevToolsMessageType` and `EDevToolsAction`. Enum values match the previous strings, so
  serialized state stays compatible.
- `ResourceCarburetor.load(args)` no longer takes the internal notification flag, and its
  argument type defaults to `void`, so a resource without arguments is loaded as `load()`.
- Data read through a carburetor is typed deeply read-only, so the compiler rejects a write
  instead of leaving it to the runtime guard.
- `peerDependencies` widened to React 18 or 19.
- Updates are delivered immediately by default. Previously every update was delayed by a
  global 40 ms throttle window.
- `useCarburetor` returns tracked data instead of the carburetor instance. Data read this way
  is read-only; mutating it throws.
- `AntiHookComponent` owns the React lifecycle instead of monkey-patching the subclass's
  methods in the constructor. Subscriptions are established in the commit phase, so render is
  pure and an abandoned concurrent render leaves nothing behind.
- `preEmmit` / `emmitByKey` renamed to `preEmit` / `emitByKey`.
- Tooling moved to Rslib, Rsbuild, Rstest, oxlint and TypeScript 7; the demo app moved from
  Create React App and Bootstrap to Rsbuild and Tailwind CSS; React upgraded to 19.
- `AntiHookComponent.tsx`'s per-attempt connection resolver/recorder, duplicated between
  `connect()` and `connectSelection()`, and its pure selection-comparison/detachment helpers now
  live in `Component/Connection/` and `Component/Models/`; the class itself keeps only lifecycle
  orchestration. The public API and its behavior are unchanged.

### Fixed

- Cache invalidate/invalidateAll can mark accepted readonly entries stale through owned operational
  replacement. Bulk preflight finishes before live writes or request invalidation epochs change;
  no-op locked flags stay unchanged, raw failures/native aliases and late-request stale state survive.

- Operational resource/cache graph replacement preserves native accessor metadata without invoking
  getters or setters; unrelated native payloads no longer block requests or locked-slot removal.
  Actual history capture still rejects accessor-bearing native endpoints.

- Readonly resource/cache replay can restart through public load, suspend and refresh: operational
  fields are prepared on an owned graph without modifying captured endpoint restrictions.
- Failed pre-loader publication unwinds only its own request, preventing orphaned shared promises.
- Cache eviction/forget physically remove locked dictionary slots by owned replacement before
  changing the eviction ledger, preserving surviving entry failure ownership and native aliases.

- Readonly transient resource/cache replay normalizes Pending to Idle and refreshing to false
  without assigning through locked descriptors. Lazy owned graph copies preserve aliases/flags;
  reentrant publications retain graph ownership without suppressing their independent branches.

- Resource owned replay does not assign an unchanged normalized status into a readonly endpoint,
  preserving Idle/Success/Error descriptor flags and usable undo/redo cursors.

- Newly restrictive value-changing branch replacements and additions retain readonly/configurable
  flags through history redo. Producer payload copies preserve restrictions before classification;
  descriptor-only metadata remains outside ordinary state notifications.

- History preflights owned-baseline patch capabilities, falling back to exact owned endpoints
  for readonly/non-configurable targets without mutating held snapshots.
- Snapshot restore detects changed locked object references before any sibling mutation.
- Throwing patch observers cannot interrupt attribution of applied writes or later patch delivery;
  effective changes still publish and the original first observer error is retained.

- Cross-format consumer verification runs a temporary CJS probe instead of a large `node -e`
  argument, avoiding Windows command-line limits while retaining every runtime scenario.

- Accepted readonly values restore without partial sibling writes or native assignment errors.
  History classifies readonly ownership during capture and replays its exact owned descriptors.
- Successful same-content branch identity replacement invalidates native alias ownership even
  when no value path changes; failed replacements leave ownership intact.

- Watch files dependency reads only after comparison and changed-result detachment complete.
  Later selected leaves remain subscribed after an early difference or reordered branch.

- Equal-valued plain key reorders publish enumeration changes and refresh detached selections.
  History restores original key positions after deletion/reinsertion; ordinary scalar, numeric-key
  and array-index changes retain patch recording. Restore preflights append-impossible ordering
  before any in-place writes.

- Native alias selections reuse a root-owned path index until mutation invalidates it, replacing
  repeated full-root searches with one ownership walk while preserving precise live aliases.

- History classifies locked array descriptors during its existing ownership pass, removing
  two extra full endpoint walks for ordinary opaque changes. Primitive patches remain allocation-free.

- Persistent array connection descriptor queries remain lawful after length locks, undo/redo
  and source replacement. Detached selections keep raw descriptor flags and stable equal identity.

- A cache load cancelled or superseded by a Pending subscriber before its loader runs rejects
  with `AbortError` instead of reporting success without an answer; replacement requests stay owned.

- Native Map/Set reads subscribe to ordinary writable aliases of exposed plain members, keys
  and own data fields. Watch, computed and connected renders observe plain-path writes;
  root backlinks remain coarse, and raw entry identities are unchanged.
- Supported array length locks publish even when only `writable` changes. History restores
  sparse contents and the length descriptor through undo/redo, including partial truncation;
  a restore failure before installation leaves its history cursor retryable.

- Computed announcement compares canonical underlying identities for native read facades,
  so an in-place exotic mutation cannot be hidden by an always-equal content comparator.
- History reconciles pending coalesced writes before undo/redo and drops canceled patch batches,
  including an independent recorder's inverse. Unchanged owned native graphs preserve redo
  without creating successful empty undo steps; mixed native graphs copy once with one alias ledger.
- Map/Set intrinsic arguments canonicalize tracked read/draft keys, members and roots instead
  of inserting proxy identities. Watch/computed lookup, receiver/chaining and `forEach`
  collection callbacks retain their real graph aliases across CJS/ESM copies.
- History owns Map/Set/Date graph endpoints without changing the opaque-by-reference snapshot
  contract. Producer-owned capture and exact owned replay preserve native/plain aliases,
  descriptors and wire keys. Clear resets the current baseline and removes pre-clear deferred
  work without discarding later coalesced writes or another history's entries.
- Plain history endpoints use a descriptor-safe graph copy instead of the generic native
  detacher. Native-containing graphs still use the strict copier with aliases and refusal
  boundaries intact; stored endpoints remain detached from mutable live state.
  Opaque publications capture once and reuse an immutable saved baseline until a patch needs
  its own mutable mirror. Capture classification stays local and preserves opaque sibling aliases.
- Keyed-cache raw failures belong to their entry object. Whole-entry draft/update replacement
  clears the prior raw cause before subscribers run, including same-message Errors; identical
  replacements cannot inherit it, and unrelated same-entry writes preserve it.
- Single-slot keyless `setData` replacement drops obsolete settled-key ownership before
  subscribers run, including equal-valued replacements. Exact-object no-ops and explicitly
  keyed restore/hydration retain their matching answer; current requests remain alive.
- History records nested synchronous publications separately before ordinary subscribers run.
  Subscriber- or abort-triggered writes during undo/redo form fresh branches and invalidate redo,
  rather than being suppressed as replay. Transaction/throttle coalescing remains intact.
- Multiple histories retain independent limits and disposal; replacing a patch-only observer
  does not disconnect them. Explicit patch endpoint presence preserves missing keys independently
  of every legal symbol/undefined payload; the shared opaque marker preserves snapshot replay
  when the store and history come from different CJS/ESM formats.
- Computed delivery skips registrations installed or replaced during an earlier publication;
  genuine subsequent publications still reach them.
- Supported object/array prototype changes publish a branch replacement. Snapshot, restore
  and undo/redo retain null-prototype containers instead of silently changing their topology.
- Detached selections preserve aliases between tracked plain views and raw Map keys in either
  traversal order, without losing dependency reads. Class selections copy ordinary Map/Set/Date
  values consistently with hooks and watchers; safely copied views no longer trigger live-escape
  warnings, while opaque live facades still do. One weak registry records view identity.
- Replacing a cache entry discards its former raw rejection without disturbing unchanged entries
  or current requests. Explicit invalidation re-arms initially failed mounted readers after commit;
  aborting that retry preserves its quiet guard even after replacement or hydration.
- In-flight cache answers cannot consume a later explicit invalidation. Suspense-only stale
  Success reads revalidate with deferred publication; explicitly invalidated Error reads suspend
  on their retry, while failed entries remain quiet without another re-arm.
- Single-slot whole-state replacement reconciles raw errors before publication even when the
  wire message is unchanged; exact current-object no-ops and unrelated draft/update writes retain
  the original rejection. No keys are invented or current requests cancelled. Keyed-cache actions
  reconcile only affected error/status paths, preserving unrelated raw failures.
- Detached supported arrays preserve ordinary, null and `Object.prototype` topology; real Array
  subclasses remain rejected by class selections. Ordinary Map/Set/Date copies retain own data
  descriptors, hidden/symbol fields and graph links, and reject accessors without running getters.
- Persistent connected plain/array/native roots detach from their current raw targets, preserving
  legal descriptor flags, raw Map-key aliases and native self-cycles after replacement or source
  swaps. Native copying uses intrinsic methods, so own `forEach`/`getTime` accessors are rejected
  without being called; native roots retain their coarse subscription.
- Cross-copy selectors share weak read-view/raw-target identities, preserving Map-key aliases
  when a CJS store is consumed by an ESM hook or class connection.

- Shared throttles isolate store-local subscription ids. Synchronous delivery no longer sends
  an earlier event to a registration installed while that event is being delivered.
- Plain-object inherited names track their exact paths, so adding or deleting an own shadow
  updates computed values and watchers without broadening array-method subscriptions.
- Resource history preserves settled keys through undo/redo using complete wire snapshots,
  without constructing discarded concrete patch payloads. Key-only restores publish once;
  identical wire snapshots remain no-ops.
- Selector hooks re-evaluate a suppressed selection when their equality comparator changes.
- Persistence reports failed reads without deleting unread entries, reports malformed data
  before a separate cleanup failure, and preserves exceptions from startup error handlers.

- Computed reads refresh before deferred transaction/throttle delivery, without consuming the
  final announcement. Hook and class bridges detect same-reference exotic changes between
  render and first subscription while keeping unchanged snapshots stable.
- Draft definitions validate effective writable/configurable flags, including JavaScript's
  omitted-flag defaults. Refused assignments and deletions no longer create phantom history.
- Persisted resources retain the key needed to reuse restored successful and failed answers.
- Detached selections preserve repeated Date identity, including Date Map keys and Set members.
- Throttle callbacks remain cancellable during delivery, including enclosing batches during
  nested explicit flushes; same-id replacement discards obsolete queued registrations.
  Recursive flushes share one depth budget and recover after a loop failure. Normal flushes
  reuse pending maps and a prototype traversal callback, clear each completed batch once,
  and allocate an error list only after a failure.
- Resource cache views use `Object.is` for data, preserving signed-zero changes and unchanged
  NaN view identities.
- Development unpublished-draft checks reuse one callback per store; production instances do
  not allocate that diagnostic field.

- `restore()` lost a sparse array's growth by `length` alone: the live array kept its length and no
  update was published.
- `setData` and `restore` announced nothing when only a non-enumerable property changed, and
  `restore(snapshot())` woke every subscriber of a store holding a symbol key.
- A subclass overriding `ComponentUpdateThrottle.runUpdater`, `CarburetorScope.get` or another
  scheduler, scope, history or diagnostics member with method syntax was silently ignored.
- A subclass overriding a store member with method syntax (`preEmit() {}`) was silently
  ignored: the base class's arrow-function field shadowed it.
- Two copies of the library sharing one process — a duplicated install, or the same install
  loaded through both its CJS and ESM builds — each built their own `CarburetorContext`,
  update batch, update wave and `getUid()` counter, so `contextType` silently read `null` under
  a live provider built by the other copy, a `transaction()` or `Computed` spanning both copies
  could batch incorrectly, and two computeds minting the same uid in different copies could
  drop one another's settlement (`UpdateWave.defer`) or steal one another's subscription
  (`Carburetor.subscribe`). `carburetorToken`'s duplicate-name check was also per copy, so a
  name taken in one copy went unnoticed in the other. All five are now shared across every copy
  via a `globalThis`-keyed singleton, and development builds report once when a mismatch (a
  foreign copy, or copies bound to different React installs) is detected.
- `require-module-function`'s autofix, extracting a `#name` method, also rewrote `this.name`
  calls to a same-named public member, silently redirecting them to the extracted function. The
  reference scan and the overload check now match only the target's own `this.#name` form.
- `connectSelection()` copied an `Array` subclass by swapping the prototype onto a plain array,
  yielding an `instanceof` impostor whose methods threw on their private fields. It now rejects
  the subclass with an actionable error.
- `useCarburetorValue()` rebuilt `Map`, `Set` and `Date` subclasses as the base built-in, dropping
  their prototype and private fields without reporting it. A subclass now reaches the same
  actionable class-instance error as any other class instance.
- The lint plugin's native bridge left one result file per lint run in the temp directory and
  never removed it; with a reused process id a waiting worker could read an earlier run's
  diagnostics, or a result still being written. Bridge files now live in a `carburetor-lint`
  temp subdirectory, are named after the lock's own file identity, are published by atomic
  rename and are deleted at process exit; files of dead processes are swept.
- `require-bind-for-passed-method` reported `this.method.bind(this)` as an unbound reference,
  because it treated `this.method` as passed by value everywhere except a call's own callee or an
  assignment's own target — missing that `this.method` sitting as the object of `.bind`'s property
  access reaches through it the same way `this.x.y` does. Found by dogfooding the native port on
  this repository's own tests, one of which uses exactly that pattern to demonstrate a different
  hazard.
- Subscriptions were never released on unmount, so a carburetor kept the component instance
  alive forever and the leak grew with every mount/unmount cycle.
- Updates queued while the throttle was flushing (for example from an effect writing to a
  carburetor) were silently dropped.
- Declaring `componentDidMount` or `render` as a class property in a subclass silently
  disabled all effects, because the field initializer overwrote the constructor's patch.
- Effects ran twice per carburetor-driven update: `forceUpdate` already triggers
  `componentDidUpdate`, which re-ran them.
- A cached nested write proxy kept pointing at a replaced branch, so writes after a nested
  array or object was replaced went to the stale object.
- Notification loops crashed when a subscriber unsubscribed another one while the batch was
  being delivered.
- A computed that read another computed registered no dependency and returned a stale value:
  the reader now accepts computeds, and a chain propagates.
- A computed read before anyone subscribed collected its dependencies but never observed them,
  so it silently stopped updating.
- Undo/redo deep-copied the whole state twice per step; `restore` already copies what it is
  given, so the recorded entry becomes the current state as it is.
- Development diagnostics were guarded by a runtime lookup a bundler cannot substitute, so they
  shipped to production and ran there. The guard is now a literal `process.env.NODE_ENV`
  comparison with the message inside it, verified absent from a production bundle.
- A write into an untrackable value through `draft` was lost silently: `this.draft.index.set(k, v)`
  mutated a `Map` the proxy cannot wrap, recorded no path, and `emitUpdate` then concluded that
  nothing had changed and woke nobody — not even the forgotten-`emitUpdate` warning fired.
  Handing out such a reference now records the path it came from, so the subscribers of that
  path are notified. The same held for a store whose root is untrackable, which now invalidates
  everything.
- `Object.defineProperty` on draft data never reached the set trap, so the write landed in the
  data and woke nobody. It has a trap of its own now.
- A write under a symbol key recorded no path and was dropped the same way; it now invalidates
  everything, since a symbol cannot be expressed as a path.
- `update(mutate)` given an `async` callback published at the first `await` and left every later
  write unpublished with no warning; development now reports it.
- A `ResourceCache` key containing the path separator (`.` or `~`) never notified its readers:
  read, write and retention paths built different strings for the same entry. All of them now come
  from one `joinPath` builder, the same one the tracking proxies use.
- A `connect()` branch that stopped being read kept its subscription and re-rendered after an
  unrelated write, and reads from handlers, effects or child commits could pollute a render's read
  set. Reads are now attributed only to the render attempt open during render; subscriptions are
  established only by a commit.
- An array-rooted `connect()` view failed `Array.isArray` and threw on enumeration or
  serialization. The facade's object/array kind is now fixed at declaration, non-configurable
  descriptors are answered lawfully, and prototype or extension changes are rejected.
- One throwing computed subscriber or settlement could skip the delivery owed to the others;
  delivery is now isolated per observer and per queued settlement.
- A four-node computed chain re-subscribed every edge on every recompute — ten body calls per
  source write. Unchanged edges are kept now, and each node evaluates once.
- The proxy cache kept every branch wrapper forever, pinning deleted and replaced data objects; an
  obsolete entry is now collectable on its own, the moment nothing outside the cache still
  references the raw object it was minted for.
- A title-only todo edit ran the full count and sort derivation; the work now stays proportional
  to the action.
- `connect()` and `connectSelection()` resolved their source on every field access; the resolver
  now runs at most once per render attempt, shared with the baseline version capture.
- The DevTools connector re-cloned every connected store on every notification; snapshots of
  stores whose version did not change are now reused.
- A computed's first real change could be silently absorbed by another subscriber reading it
  mid-wave, between invalidation and settlement. Publication is now judged against the last value
  actually delivered, kept independently of the evaluation cache a mid-wave read can refresh.
- An unequal-depth dependency graph (a value read both directly and through a chain of derived
  computeds) could publish an intermediate, mixed-generation value before settling to the correct
  one. Invalidation now propagates downstream immediately, separately from settlement scheduling,
  so a settlement that pulls a stale dependent always recomputes it from current inputs; a
  dependency that fails to settle now correctly makes its dependents stale too, instead of one
  silently serving its last-good cached value forever.
- Restoring a resource snapshot, or hydrating a successful one into a fresh instance, lost track
  of which arguments the answer belonged to: a restored snapshot's data could be served for a
  different, unrelated key. `snapshot()`/`restore()` now carry the settled key.
- A subclass declaring a class-field `render` together with `getDerivedStateFromProps` or
  `getSnapshotBeforeUpdate` mounted with zero subscriptions, because React does not call
  `UNSAFE_componentWillMount` for a component defining either of those. The render boundary is
  now installed at definition time through a proxy over the instance, independent of any React
  lifecycle hook actually being called.
- `connectSelection()`'s equality check ignored key presence/removal at equal cardinality (a key
  swapped for another with the same count) and symbol-keyed properties, so some real content
  changes did not update a memoized child. The later conservative treatment of exotic selection
  members (Map/Set/Date/class instances) as always-changed was reassessed in the round-6 review
  and kept as a deliberate correctness-over-performance tradeoff, to be revisited only if
  real-app profiling shows a measurable cost.
- An abandoned render (one that suspended or threw) could leave a queued resource load to fire at
  a later, unrelated commit on the same instance. Deferred loads now live on the render attempt
  itself and are discarded with it.
- A throwing effect cleanup, or a throwing component-wide `unUseEffects`, stopped the rest of
  unmount teardown, including subscription release, leaving the store still subscribed to an
  unmounted component. Each teardown stage now runs isolated; failures are reported afterward
  instead of interrupting the stages that follow.
- A todo store hydrated with populated items but omitted counter fields published wrong (zero)
  `activeCount`/`doneCount` on its first single-item write: the write's own arithmetic zero-filled
  the missing counters before the "first derivation" fallback checked whether they had ever been
  initialized.
- The write proxy's no-op check used `===`: assigning `undefined` to an absent key created no
  property, `-0` over `+0` was treated as unchanged, and re-assigning the same `NaN` was treated
  as a write. It now requires the key to already be an own property and compares with `Object.is`.
- A nested branch of a `connect()`/`read()` view still allowed `setPrototypeOf`/`preventExtensions`
  to reach the real backing object, even though the outer view already rejected both.
- The render boundary called a subclass's `render()` with the raw base instance as receiver, while
  the base constructor actually returns a Proxy over that instance. A subclass's native `#private`
  field or method is installed on the returned proxy, so the mismatched receiver failed the
  brand check the first time `render()` (or a prototype method it called) touched one. The
  boundary now closes over and calls against that same returned proxy.
- `reportLiveViewEscape` and `detachSelection` only inspected or copied one level of a
  `connectSelection()` result, so a live store view nested inside a plain object or array — or
  reachable only through a symbol key — escaped undetected and undetached, leaving a memo child
  silently stale after a change the owner's shallow copy did not carry. Both are now bounded,
  cycle-safe recursive traversals covering any depth.
- `ResourceCache` inherited `restore()` from `Carburetor`, which replaced data but left the
  request/controller maps untouched, so a pre-restore refresh's late answer still passed the
  currency check and overwrote the restored entry. `restore()` is now a request-generation
  boundary: every in-flight controller/request/failure/view-cache entry is aborted and cleared
  before the restored state is installed.
- A restored `ResourceCache` entry or single-slot resource snapshot could carry `refreshing`/
  `Pending` with zero live work behind it, leaving a mounted reader stuck showing an indefinite
  pending/refreshing indicator. Restore and hydrate now normalize `refreshing` to `false` and
  `Pending` to `Idle` — restore has no render/effect to attribute a fresh request to, so it
  serializes the answer only, and an entry still marked `invalidated` gets refetched through the
  existing `useResource` fetch gate once mounted.
- A plain object's symbol-keyed branch bypassed both tracking proxies: reading it returned the
  raw, unwrapped object (mutable, unrecorded), and a nested `draft` write under a symbol key
  changed data without publishing. Both traps now record a wildcard for a symbol-keyed access and
  wrap a trackable value the same way a string-keyed branch already is.
- `useCarburetor`/`connect()` made server-rendering N components over one shared store an O(N²)
  cost: every fresh read proxy's cache registered a watcher in an invalidation ledger kept per
  raw object, and every proxy construction, read and write walked every watcher ever registered
  against it. The ledger — watchers, revisions, `retire()`, `invalidate()`, and the runtime
  `WeakRef` requirement it rested on — is gone. Each proxy tree now caches its branch wrappers
  in a `WeakMap` keyed by the branch's own raw object: a removed or replaced branch's entry is
  collectable the moment nothing outside the cache still references it, so eviction needs no
  read-driven sweep, no write-driven invalidation and no explicit `release()`.
- An unequal-depth computed graph (a node read both directly and through a derived chain) could
  recompute a node's body twice per write: an eager `get()` during a sibling's settlement already
  reran it against current inputs, then the node's own deferred `settle()` recomputed it again
  unconditionally. Both now check the existing valid/drifted state first and skip the redundant
  recompute when an eager pull already caught the node up.
- `ResourceCache.getEntry()`/`useResource()` still hand out the entry's stored `data` object
  itself, so mutating a field on it changes the cache silently — this is a known, documented sharp
  edge (`docs/hazards.md`, H23), not newly introduced. Reassessed in the round-3 review and kept
  as documentation-plus-lint rather than a runtime-wrapped return: `data`'s type is an
  unconstrained generic, the view is rebuilt on every render of a hot path, and this store
  deliberately refuses to wrap a frozen branch during a tracked read rather than serve one, which
  rules out the read-only strategies considered. A regression test now pins the current behavior.
- `connect()`'s and `connectSelection()`'s declaration-time shape probe caught every exception from
  its one resolver call as "source not resolvable yet," which also silently discarded a resolver's
  genuine, unrelated error; if a later call then returned the other object/array kind, the
  boundary error blamed a deferred source and gave no way to see what had actually gone wrong. The
  probe's error is now kept and attached as the `cause` of that boundary error instead of
  discarded, while a resolver that is legitimately not ready yet still declares exactly as before.

### Removed

- The global `componentUpdateThrottle` singleton, superseded by per-carburetor schedulers.
- A dead hand-written `Partial<T>` that duplicated the built-in TypeScript utility type.
