# Render rules for function components — implementation plan, 2026-10-16

Status: design settled, implementation in progress. Tasks: `FC-1` … `FC-6` (§8).
Owner decisions (2026-10-16): capturing closures in a function component are reported with
hook-free advice — a child `AntiHookComponent` with a `@bind` method, or converting the component —
and a `useCallback`/`useMemo` wrapper is reported too (it is the manual cache the library exists to
remove). Scope: H21, H31, `useMemo`/`useCallback` over store reads, inline hook selectors.

## 1. Goal

The render rules of the native linter (`native/`, binary `carburetor-lint`, bridged to
oxlint/ESLint by `plugin/src/Utils/Native`) today understand render only inside
`AntiHookComponent`/`ScopedAntiHookComponent` classes: `walk.rs` sets `Context::in_render` in a
component's `render` member. A function component gets none of H21/H29/H31/H32; only H30
(`require-module-function`, scope `all`) reaches it.

Acceptance:

- A function component's body is render code for H21 (`no-handler-created-in-render`) and H31
  (`no-function-in-render`), with messages that give hook-free advice.
- `useCallback(fn, deps)` and `useMemo(() => fn, deps)` producing a function in a function
  component are reported by the same rules as the bare inline function they wrap.
- New rule H33 `no-memo-over-store-read`: `useMemo`/`useCallback` whose callback reads a binding
  produced by `useCarburetorValue`/`useComputedValue`/`useResourceValue` in the same component →
  move the derivation into the selector or into a `Computed` read with `useComputedValue`.
- New rule H34 `no-capturing-hook-selector`: a selector passed inline to one of those three hooks
  that captures render state (props, locals) → rebuilt and re-run every render; read through
  `AntiHookComponent#useCarburetor` (no selector) or select the whole record and pick in render.
  A capture-free inline selector stays H30's (no double report).
- No new diagnostics in `lib/src`, `examples/` (proper examples stay at zero) and the demo; any
  real finding there is fixed in code, not suppressed.

Non-goals: custom hooks (`useX` functions) as render scope; class components (unchanged);
autofix; type-aware detection.

## 2. What is a function component

Syntactic, no type information (same constraint as the rest of the walker):

- a function declaration, function expression or arrow function whose binding name is
  PascalCase — `function Row()`, `const Row = () =>`, `export default function Row()`,
  `const Row = function () {}` — **and** whose own body (not nested functions) contains JSX
  (an element/fragment in a `return`, or an expression body that is JSX);
- or any function passed as the first argument to `memo`, `forwardRef`, `React.memo`,
  `React.forwardRef` (name optional, JSX requirement unchanged).

Render scope = that function's body, entered the way a class `render` member is; nested
functions end render scope except synchronous callbacks the walker already treats as running in
place (array callbacks). `Context` gains `render_kind: RenderKind { Class, Function }` so rules can
choose their message; `in_component` stays class-only (rules that are about class members keep
their meaning).

Edge cases to test: PascalCase function without JSX (not a component); lowercase function with
JSX (not a component); nested component declared inside another component (each is its own
render scope; the inner declaration itself is also an H31 finding in the outer one); class
render unchanged; component in `.ts` via `React.createElement` (not detected — documented).

## 3. H21 / H31 in function components

- H21: an inline function, `.bind`, or a `useCallback`/`useMemo` call yielding a function, passed
  to a JSX **component** prop → report, except a locally declared handler passed through
  `useCallback(handler)` or `useMemo(() => handler)`: that reports at its declaration under H31
  if capturing, or H30 if capture-free. An inline function inside a hook call used as the prop
  remains H21. Message (function kind): capture-free → module-level function; capturing → move
  the handler into a child `AntiHookComponent` that receives the data as props and passes a
  `@bind` method, or convert this component to `AntiHookComponent`. Module-level advice is valid
  only when there is no reference to any non-module outer binding, lexical `this`, or `arguments`;
  capturing factories/HOCs should use a hook-free child component.
- H31: inline functions on DOM attributes, local function declarations/arrow consts, synchronous
  array callbacks in the body → report, same split of advice. `useCallback`/`useMemo` yielding a
  function counts as a local function except when it merely passes through a local handler as
  described above.
- Dedupe with H30 exactly as today for classes (host-side, keyed by `sourceCode`): a capture-free
  function reported by H30 is not double-reported by H31/H21.

## 4. H33 `no-memo-over-store-read`

Track, per function component, local bindings initialised from a call to `useCarburetorValue`,
`useComputedValue` or `useResourceValue` (identifier or destructuring). A `useMemo`/`useCallback`
whose callback body references such a binding → report at the hook call. Default severity `warn`.
Advice: the selector already recomputes only when its reads change — derive inside the selector,
or define a `Computed` and read it with `useComputedValue`.

## 5. H34 `no-capturing-hook-selector`

Second function argument (`select`) of `useCarburetorValue(source, select, isEqual?)`, or third
function argument of `useResourceValue(source, args, select, isEqual?)`, when inline and referencing
a binding of the component's render scope (parameters, locals) → report. `useComputedValue(computed)`
has no selector and is not covered by H34. Capture analysis reuses the closure support behind
H29/H30 (`support/closures`). Default `warn`. Capture-free inline selector → H30 only.

## 6. Plumbing per new rule

Registry (`native/src/rules/mod.rs`, count 27 → 29), `config.rs` defaults, JS plugin rule
wrappers and schema (`plugin/src/Rules/...`, `recommended.mts`, `no-hooks.oxlintrc.json` if
relevant), `docs/rules.md` table + sections, `docs/hazards.md` H33/H34, `README.md`/
`docs/adopting.md` short note in the hooks part, `examples/wrong/<rule-id>/` negative examples
(exactly their rule; `.expected` files where several fire), CHANGELOG (Unreleased, Added).
`.oxlintrc.json` overrides keep the allocation/render rules off for `__tests__`, `perf`,
`scripts` as today.

## 7. Verification

`cargo test` (unit tests per rule: positive, negative, edge cases of §2), `npm run lint` (whole
repo, zero errors and no new warnings in `lib/src`/`examples`), `__tests__/Native`,
`__tests__/Plugin` (rules project), `__tests__/Tooling`, docs:build/docs:check, typecheck,
checkLayout, full `npm test`; CI fast + full (native binary changes → Rust jobs run).

## 8. Tasks

- **FC-1** walker: function-component detection, `render_kind`, render scope; unit tests for §2.
- **FC-2** H21/H31 for function components incl. `useCallback`/`useMemo` wrappers; messages;
  H30 dedupe. Blocked by FC-1.
- **FC-3** H33 `no-memo-over-store-read`. Blocked by FC-1.
- **FC-4** H34 `no-capturing-hook-selector`. Blocked by FC-1.
- **FC-5** plumbing: registry, config, JS plugin, docs, examples/wrong, CHANGELOG; repo findings
  fixed. Blocked by FC-2..FC-4.
- **FC-6** review (rush reviewer) and CI fast + full. Blocked by FC-5.
