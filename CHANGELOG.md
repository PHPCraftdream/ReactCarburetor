# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AntiHookComponent.connect(source)`: a persistent view of a carburetor, built once (a field
  initializer is the intended call site) and read directly in render, instead of a fresh
  read-tracking proxy on every `useCarburetor` call. `source` is a carburetor or a function
  resolving one, so a prop swap re-points the connection; `setData`/`restore` keep the same
  returned view live across a whole-data replacement. Reads are still tracked field by field
  every render, so a conditional branch reading a different field still narrows or widens the
  subscription correctly — only the object identity and its underlying proxy are reused.
- `AntiHookComponent.connectSelection(source, select)`: the supported way to hand connected data to
  a child gated by shallow props comparison. Declared once like `connect` and called in render; the
  selector's reads subscribe the owner, and the returned snapshot is detached plain data whose
  identity changes only when the selected content changes — `Object.is`, one level deep, the same
  comparison a props gate applies. Handing a live view through a selection is reported once per
  selection in development.
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
- `react-carburetor/lint`: 22 lint rules for the ways consumer code can go wrong silently — a write
  that reaches no subscriber, a component reading state it never subscribed to, an effect whose
  cleanup is dropped, a computed that never invalidates. One plugin serves both hosts, since oxlint's
  JS plugin API is ESLint's: oxlint consumers add one `extends` line pointing at the shipped
  `recommended.oxlintrc.json`, ESLint v9 consumers spread `carburetor.configs.recommended` into a
  flat config.
- A native Rust port of all 22 rules (`native/`), and the JavaScript plugin rewritten into a thin
  bridge that calls it: the whole set of rules now has one implementation, not a JavaScript one and
  a native one kept in sync by hand. Measured on this repository, the native pass takes 20 ms
  against the 270 ms the 22 rules cost as a JavaScript plugin — the difference is multiplied by
  every project that depends on this library, which is the reason it exists. The bridge spawns the
  binary exactly once per lint run and shares that one result across every rule and every file,
  including under ESLint's `--concurrency`, where several worker threads coordinate through a lock
  file in the OS temp directory rather than each spawning their own copy. Every rule keeps
  reporting through the host it always did — suppression comments, editor diagnostics and per-rule
  severity all still work, because the bridge only tells a rule which of its own findings exist; it
  never decides whether or how loudly to report them. A conformance suite runs both the native
  binary and the (now retired) reference behaviour over one shared fixture corpus and requires
  identical output, file by file, line by line, rule by rule.
- House style rules in the unpublished plugin, on for the whole repository: `max-line-length`
  (120 columns, a tab counted to its tab stop), `require-tsdoc` and `no-blank-line-after-tsdoc`,
  which fixes itself under `oxlint --fix`. `max-line-length` ignores string literals by default,
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
  obsolete entry is now released when a write covers its path.
- A title-only todo edit ran the full count and sort derivation; the work now stays proportional
  to the action.
- `connect()` and `connectSelection()` resolved their source on every field access; the resolver
  now runs at most once per render attempt, shared with the baseline version capture.
- The DevTools connector re-cloned every connected store on every notification; snapshots of
  stores whose version did not change are now reused.
- Views release replaced or deleted branches on every kind of read now: primitive leaf reads,
  `in` checks and key enumeration sweep the proxy cache like branch fetches do, so a view left
  reading only a count or an emptied dictionary no longer pins the removed subtree for its
  lifetime.
- The proxy cache's invalidation ledger is bounded: a published write record is retired once no
  live cache needs it — every cache sharing the raw object's scope has swept through it, or none
  of the laggards holds an entry it would evict — so the metadata tracks live caches and pending
  writes instead of lifetime write churn, and a sweep stops rescanning retired history.
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
  changes did not update a memoized child.
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
- `invalidate()` pushed a new record onto an unbounded array per write, so an idle-but-live view
  retained a growing invalidation worklist even for the same path written repeatedly. Records are
  now keyed by path, so a later write to a pending path replaces that path's record instead of
  piling up beside it.
- Every fresh `read()` view (including the one `useCarburetor` builds on every render) registered
  a `WeakRef` watcher that was only pruned by a later retirement pass, itself only triggered by a
  write — a read-only workload accumulated watcher slots indefinitely. The proxy cache now also
  retires on construction, and exposes an explicit `release()` a view can call when its owner
  knows its lifecycle is over, independent of GC timing.
- `WeakRef` was a hard runtime dependency with no stated floor; the first tracked `read()` threw
  outright wherever it was absent. `package.json`'s `engines.node` now states `>=14.6.0`, where
  `WeakRef` shipped unflagged.
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
