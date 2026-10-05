# Allocation lint rules — implementation plan, 2026-09-23

Status: design only, nothing implemented. Tasks: `LA-0` … `LA-7` in the session TaskList (§14).
D1/D2/D6 settled by the owner on 2026-09-23 — see §13 for the final decisions and the sections
below for what changed because of them.

## 1. Goal

Two new rules in the shipped native linter (`native/`, binary `carburetor-lint`), reported to
oxlint/ESLint through the existing JS bridge like the other 22. They are low-level safety rules:
the hazard is an **avoidable allocation** — a function object created on every call of a method
(every render, when the method is `render`), or once per instance where once per module would do.
Same family as H21, which is about a fresh handler per render defeating the props gate; these are
about the allocation itself.

- **R1 `require-method-for-closure` (H29).** A closure inside a class member that depends on the
  class, and whose other dependencies can be supplied through the extracted method's parameters or
  re-read from class fields, must become a method.
- **R2 `require-module-function` (H30).** A closure or a member that depends on nothing in the class
  must live at module level.

Both are suppressible with the existing directives (`carburetor-disable-next-line <rule>` etc.).

**Acceptance.**

- `orderIds.map((id: string) => <TodoItem key={id} carburetor={carburetor} id={id}/>)` in
  `TodoApp.render` — the case fixed by hand in `98a4a3a` — is reported by R1.
- `renderPlusIcon`, `renderCounter`, `renderEmpty` in `lib/src/ToDo/TodoApp.tsx` (no `this`) are
  reported by R2 (under the recommended D1 policy).
- No report whose suggested rewrite would change behaviour or would keep the allocation.
- Every existing safety rule keeps seeing the code it sees today (§9).

## 2. The criterion that decides everything

**A report is valid only if the rewrite it asks for leaves no per-call allocation behind.**

- `.map((id) => this.renderRow(id, carburetor))` still allocates after "extraction" — not a valid
  rewrite. So a callback may only use captured locals that the method can re-read from class
  fields itself; a plain local captured by a callback blocks the report.
- `const fmt = (x) => x + suffix; fmt(a); fmt(b);` → a method or function with an extra `suffix`
  parameter allocates nothing — valid.
- A closure in a class-field initializer (`todos = this.connect(() => this.props.carburetor)`)
  allocates once per instance, and so would its bound-method replacement — no gain, not reported.

## 3. Classifying a closure

**Candidate:** an `ArrowFunctionExpression` or `FunctionExpression` lexically inside the *body* of
a class member (a method, or a class field whose value is a function), which is not the member's
own body and not inside a nested class. Exclusions in §5.1.

For each candidate:

1. **Captures** (§5.2) — value references inside the closure that resolve to a binding declared in
   the enclosing member (its parameters or locals, at any depth outside the closure). The closure's
   own bindings, module-level bindings and globals are not captures.
2. **Class dependency** (§5.3) — `this`, `super`, `#private` use, or a *this-derived* capture.
3. **Usage** (§5.4) — `DirectHelper` (bound to a never-reassigned local whose every reference is a
   direct call) or `Callback` (anything else).
4. **Passability** of each capture:
   - this-derived — passable in both usages (the method re-reads it from `this`);
   - any other — passable only in `DirectHelper`, and only if the binding is never written after
     its initialisation (neither by the closure nor later in the member);
   - a capture the closure *writes* blocks the report in every usage (passing by value would
     change semantics).

| class dependency | every capture passable | report |
|---|---|---|
| yes | yes | R1 |
| no | yes | R2 (closure) |
| — | no | nothing |

Consequence: an R2 closure in `Callback` usage needs zero captures (a plain capture is not
passable there, and a this-derived one is a class dependency by definition).

## 4. How it fits the crate

Facts from the investigation (task #132):

- Standalone Rust binary on `oxc_parser`/`oxc_ast` `=0.150.0`, no `oxc_semantic` **yet** — every
  existing rule works without a scope analyser (`support/walk.rs`, `Context::function`). This pair
  of rules is the first to need real scope/binding resolution (free-variable capture analysis for
  R1) and same-file class-heritage resolution (D6), so `oxc_semantic = "=0.150.0"` is added as a new
  dependency (D2, owner-approved) — pinned exactly like the rest of the `oxc_*` family. **Used
  minimally**: one `SemanticBuilder` pass per file, read only for (a) resolving which declaration an
  identifier reference binds to and (b) walking a same-file `extends` chain; no type-checking, no
  cross-file resolution, nothing else pulled from it. Verify the exact `oxc_semantic` 0.150.0 API
  (`SemanticBuilder`/`Semantic`/`Scoping` surface can differ across oxc releases) at the start of
  LA-1 — it was not available to inspect while writing this plan.
- Rules are `fn(&Program, &Source) -> Vec<Diagnostic>` rows in `rules/mod.rs::REGISTRY`; most use the
  shared `walk_rule` driver and the `Rule` trait (`support/walk.rs`); severities come from
  `config.rs::DEFAULT_SEVERITIES`, mirrored by `plugin/src/recommended.mts`.
- The JS side is a thin bridge: `plugin/src/Rules/**/*.mts` are `nativeRule(id, description)`
  wrappers that relay the native binary's diagnostics. No detection logic is duplicated in JS.
- Suppression is rule-agnostic (`native/src/suppression.rs`) and applies to every id in
  `main.rs::analyze` — nothing to build for new rules.
- Detection is syntactic by policy elsewhere in the crate: classes are recognised by the name in
  `extends` (`support/bases.rs`), overrides by known member names, no type information anywhere.
  These two rules relax that one specific corner (same-file heritage, D6) using the new semantic
  pass; they do not change how any of the other 22 rules recognise a class.

**Hook-in.** Use `walk_rule` and the existing `class`/`method`/`property` callbacks — no new walk
hooks. At `method`/`property` the rule runs its own sub-visitor over *that member only*.

- **Lifetimes.** `Rule` callbacks receive short-lived references (`&MethodDefinition<'a>` with an
  elided borrow), so nothing AST-borrowed may be kept in rule state across callbacks. Each member's
  analysis finishes inside its callback; cross-callback facts (per-class facts from the `class`
  callback) are stored as owned data keyed by `Span`, the pattern `require_bind_for_passed_method`
  already uses for its `facts`.
- **No descent into nested classes.** The outer walk reaches their members itself
  (`visit_class` → `visit_method_definition`); descending would report them twice.
- **Render context.** `Context.in_render` at the `method` callback says whether the member is
  render. Inside the sub-visitor, a closure *executes in render* iff the member is render and every
  function boundary between the member body and the closure is an argument of a
  `SYNCHRONOUS_CALLBACKS` call — the same rule `Walk::enter_function` applies. Re-implement that
  small propagation; `Walk`'s state is private.
- Both rules call the same analysis, and `REGISTRY` runs each row separately, so a member is
  analysed twice when both are on. Accepted: the cost is proportional to members that contain
  closures (§12). Folding both into one row is not possible — `rules::run` stamps severity per
  registry row, so one row emitting two rule ids would break per-rule severity.

New files: `native/src/rules/allocations/{mod.rs, require_method_for_closure.rs,
require_module_function.rs}` (a new category: allocation hygiene fits none of reads/writes/
lifecycle/effects/boundaries) and `native/src/rules/support/closures.rs` (the shared analysis).

## 5. Shared analysis — `support/closures.rs`

### 5.1 Never a candidate

| Excluded | Why |
|---|---|
| the member's own body | it *is* the member |
| closures in non-function class-field initializers, `static {}` blocks | once per instance/class — allocation-neutral (§2) |
| closures assigned to `this.<x>` (e.g. in the constructor) | a member in all but syntax, once per instance |
| JSX attribute values on **component** elements (uppercase tag) | H21's territory; avoids a double report (D5) |
| closures passed directly to `useEffect`, `update`, `transaction`, `computed` | other, error-level rules inspect these callbacks inline (`no-async-effect`, `require-effect-deps`, `no-async-transaction`, the draft tracking in `walk.rs`, `no-computed-get-in-computed`); extraction would blind them (D4) |
| closures executing in render whose body calls `useCarburetor`, `useComputed`, `useResource`, `getData`, `getEntry`, `emitUpdate`, `emitSoon`, `emitByKey` | moving them out of render makes `no-use-carburetor-outside-render` report a false positive and hides reads/writes from `no-get-data-in-render` / `no-store-write-in-render` |
| `function` expressions (non-arrow) using `this`, `arguments`, `new.target`; generators | their `this` is dynamic, a method's is not |
| arrows using `arguments` or `new.target` | bound to the enclosing function, cannot be passed transparently |
| IIFEs `(() => …)()` | rare; left out of the first version, documented |

DOM-element attribute closures (`<button onClick={…}>`) **are** candidates: they allocate on every
render; H21 skips them only because the props gate is not involved.

The API-name lists go into `support/bases.rs` as constants, each with a comment naming the rules it
protects, so a later change to those rules shows up next to the list.

### 5.2 Capture resolution via `oxc_semantic`

The question is still narrow: *does this name, at this reference inside the closure, bind to a
declaration inside the enclosing member, and to which one?* Module-level and global references are
free and fine either way. D2 (owner-approved) answers *how* with the real thing instead of a
hand-rolled pass: build one `Semantic` per file (`SemanticBuilder::new().build(program)`, run once
and reused by both R1 and R2 — see §12 on not paying for it twice), then for each `IdentifierReference`
inside a candidate closure, resolve its `ReferenceId` to the `SymbolId`/`NodeId` it binds to (or
`None` for an unresolved/global reference) and compare that declaration's position against the
enclosing member's span:

- inside the member, outside the closure itself → a **capture** (§3);
- inside the closure's own subtree → not a capture, it's the closure's own binding;
- outside the member entirely (module scope, an import, a global) → free, not a capture.

This replaces hand-rolled hoisting/shadowing/`catch`/`for`-head rules with whatever `oxc_semantic`
already gets right — the crate takes on zero of that logic. What still needs writing by hand, because
it is about *meaning*, not scope:

- **TS type positions must be skipped when deciding whether a reference is a "use" at all**
  (`oxc_semantic` still resolves `(x: Props) =>`'s `Props` and a type-position `typeof foo` as
  references; a closure using a captured type as a type annotation, not a value, is not a capture).
  Keep the same "in type" depth-counter from the original draft (`visit_ts_type_annotation`, type
  argument/parameter lists, the type half of `as`/`satisfies`/`<T>x`, type aliases) and skip
  resolution while it is non-zero, rather than trusting semantic analysis to make that distinction —
  confirm during LA-1 whether `oxc_semantic` already separates type-only references (some oxc
  versions flag this on the reference itself) before writing a redundant tracker.
- JSX component names are value references (`JSXElementName::IdentifierReference`) — resolve
  normally (`TodoItem` → import → free). Object shorthand `{carburetor}` likewise.
- **Writes:** `x = …`, compound assignments, `x++`, destructuring assignment targets — `oxc_semantic`
  marks a reference's read/write flags; use them rather than re-deriving from the AST.

**Same-file heritage chain (D6).** A component class is one that extends `COMPONENT_BASES` directly
**or transitively through classes declared in the same file** — the owner explicitly asked for "our
classes (inherited from us)" to count, not just a direct `extends AntiHookComponent`. At the `class`
callback: resolve the heritage expression's identifier through the same `Semantic` (a class
declaration is a symbol too) to find where `MyBase` in `class Widget extends MyBase` was itself
declared; if that declaration is a `class MyBase extends AntiHookComponent { ... }` in the same file,
walk one more link, bounded (a small fixed depth, e.g. 8, to be safe against a pathological cycle — a
real inheritance chain never gets remotely that deep). A base declared in another file (an import)
stops the walk there and falls back to the existing name-only check — the same documented,
already-accepted limitation the other 22 rules have (`support/names.rs`'s own comment: "a
project-local subclass is invisible until it is configured"); resolving an imported declaration's own
file is out of the "necessary minimum" this task was scoped to.

**This-derived** capture: a `const` binding (never written) whose initializer is a static member
chain rooted at `this` — `this.props`, `this.props.x`, `this.state.items` — or a plain property of an
object pattern over such a chain (`const {carburetor, id: key} = this.props`). Reuse
`support/chain.rs::chain_root` (`Base::This`) and require no call and no computed member in the
chain. A rest element (`...rest`) builds a new object → not this-derived. Optional chaining → not.

Subtlety: re-reading `this.props.x` inside the method gives the value *at call time*; the capture
held the value *at closure creation*. For synchronous callbacks (`map` in render) they are equal.
For handlers that run later (a DOM `onClick`) the method sees current props — the idiomatic
behaviour for class components, but a change. The message names the re-read explicitly; H29's
"False positives" section documents it.

### 5.3 Class dependency

Inside the analysed code (the closure for closures; the member's signature and body for R2 members):

- `ThisExpression` anywhere, including nested non-arrow functions — counting those too can only
  suppress reports, never produce a wrong one;
- `this` in type positions: `TSTypeName::ThisExpression` (`typeof this.x`) and `TSThisType`
  (`(): this`) — a type-level dependency on the class;
- `Super`; `PrivateFieldExpression` (`obj.#x`), `PrivateInExpression` (`#x in obj`) — they only
  compile inside the class;
- R2 members: a reference to one of the class's own type parameters (`class Box<T> { private
  wrap(x: T) … }`) — compare `TSTypeReference` names with `Class.type_parameters`, recorded at the
  `class` callback;
- closures: a this-derived capture.

`this` in a static member means the class — still a dependency. Naming the class
(`Widget.defaults`) is not: the name is visible at module level.

### 5.4 Usage

`DirectHelper`: the candidate is the initializer of a `VariableDeclarator` with a plain binding
identifier, `const` (or `let` never written), and every resolved reference to that binding in the
member is the callee of a `CallExpression`. Anything else — passed, returned, stored, `f.call(…)` —
is `Callback`. For `DirectHelper` the binding name is the natural method/function name.

### 5.5 Pure forwarders

`() => this.m()` / `(a, b) => this.m(a, b)` (same parameters, same order, callee `this.<name>`) get
their own message: pass `this.m` directly, bound once with `@bind`. A forwarder with extra
arguments (`() => this.m(this.props.id)`) is an ordinary R1 case. A forwarder with a plain-local
argument (`() => this.m(item)`) is not passable → not reported.

## 6. R1 `require-method-for-closure` (H29)

- **Scope:** closures in members of component classes only — `COMPONENT_BASES`, direct or transitive
  within the same file (D6, §5.2). Store classes (`CARBURETOR_BASES`) are explicitly out of scope
  for both new rules — the owner scoped this to render-affecting allocations, not store internals.
- **Report at** the closure's start.
- **Message** (base form, final wording at implementation; must be unique):
  "this closure is rebuilt on every call of `<member>` (on every render, for render) — an
  allocation the class does not need: everything it uses is on `this` or can be passed in. Declare
  it as a method — with @bind if it is passed as a value — reading `<names>` from `this` inside it
  [and taking `<params>` as parameters]." Variants: forwarder (§5.5), not in render.
- **No autofix.** A callback's parameters are contextually typed (`.map((id) => …)` gets
  `id: string` from the array); as a method parameter it needs an annotation the linter cannot infer
  without type information, and `noImplicitAny` would fail. Callbacks have no name to give the
  method. `@bind` method versus arrow field is a judgement call. Possible later for `DirectHelper`
  with fully annotated parameters.

## 7. R2 `require-module-function` (H30)

### 7.1 Closures

Class-independent candidates per §3, same component-classes-only scope as R1 (D6). Message: "this closure uses nothing
from the class and is rebuilt on every call of `<member>` — declare it once at module level
[taking `<params>` as parameters]". Report only: hoisting loses contextual typing too
(`.sort((a, b) => a - b)` needs annotations at module level).

### 7.2 Members

Candidate: a method (`MethodDefinitionKind::Method`) or a function-valued class field, with a body,
whose signature and body have no class dependency (§5.3), in a component class in scope (§6's D6
scope — store classes are not analysed by this rule at all, so there is no separate "store" case to
special-case here).

**D1 (owner's final answer): no visibility split.** Public, protected and private are all eligible
alike — "as soon as it's possible to extract, report it," in the owner's own words. Visibility is
not the boundary; genuine *extractability* is, and that boundary is entirely mechanical:

- `#private` fields/methods are eligible unconditionally — nothing outside the class can reference
  them by construction, so extraction never breaks a caller.
- Public/protected members are eligible too, **except** where extraction is not actually possible
  regardless of the body's content, because something outside this rule's analysis calls the member
  as `instance.<name>(...)`:
  - React lifecycle and statics: `render`, `componentDidMount`, `componentDidUpdate`,
    `componentWillUnmount`, `shouldComponentUpdate`, `componentDidCatch`,
    `getSnapshotBeforeUpdate`, `getDerivedStateFromProps`, `getDerivedStateFromError`, `UNSAFE_*` —
    React itself calls these on the instance; a body with no `this` is still not free to leave;
  - `AntiHookComponent`'s own public/protected override points (`useEffects`, `unUseEffects`,
    `useEffect`, `useCarburetor`, `connect`, `connectSelection`, `useComputed`, `useResource`,
    `track`, `loadStaleResources`, `releaseEffects`, `onCarburetorUpdate`, `commitSubscriptions`,
    `releaseSubscriptions`, `releaseConnectionViews`, …) — the base class calls these as
    `this.<name>()` internally; same reasoning. Pin the list with a test that parses
    `lib/src/Carburetor/Component/AntiHookComponent.tsx` and compares, so it cannot drift. This stays
    a name list rather than a semantic override check: resolving it properly would mean resolving
    the imported base class's own file, which is the cross-file resolution D2 explicitly stayed out
    of (the "necessary minimum").
  - a member whose containing class has an `implements` clause: it may be satisfying that interface,
    which the crate (no type-checker) cannot verify one way or the other — excluded to avoid a false
    positive that would break a real contract.

Never (mechanical, applies regardless of D1): `constructor`, getters/setters, `accessor`, members
without a body (abstract, `declare`, overload signatures), `override`, decorated members (a
decorator may register or wrap it), computed names.

Message variants by what the member costs: an arrow field or a `@bind` method is allocated **once
per instance** — say so; a plain prototype method allocates nothing per instance — the message says
it does not depend on the instance and belongs at module level (D7).

Report at the member's start; a `carburetor-disable-next-line` therefore goes directly above the
member line, below its TSDoc.

### 7.3 Autofix (members only)

Fix model today: one `Fix {start, end, text}` per diagnostic; non-overlapping fixes applied per
pass; `main.rs::stabilize` re-parses and re-runs up to `MAX_FIX_PASSES = 10`.

Moving a member touches two places and rewrites references, so the fix is **one edit replacing the
whole class statement** with `<function text>\n\n<class text without the member, references
rewritten>`. Two candidates in one class overlap → one per pass; a class with more than ten needs a
second `--fix` run (documented, acceptable). `Fix` stays a single edit — no change to `fix.rs` or the
JSON shape.

Emit a fix only when all hold, otherwise report without one:

- the class is a top-level statement: a `ClassDeclaration` in `Program.body`, directly or under
  `export` / `export default`; the function goes before that statement, including its `export`
  keyword, decorators and leading comments;
- every reference to the member inside the class is `this.<name>` / `this.#name` (callee or
  value); it becomes `<name>`. Any other form (`other.name`, `obj[key]`, `super.name`, a reference
  from another class in the file, `ClassName.name` for a static member used outside the class) →
  no fix;
- no module-level binding (top-level declaration or import) named `<name>` exists, and no binding
  named `<name>` is visible at any rewritten reference (resolver, §5.2 — shadowing). For `#name`
  the function takes the name without `#`.

Text from source slices, like `no_lifecycle_class_property::fix_for`: a method becomes
`[async ]function[*] name<T>(params): R { body }`, a field arrow `const name = <T>(params): R =>
body;`; accessibility/`static`/`readonly` modifiers are dropped. Leading comments that end on the
lines directly above the member (from `program.comments`) move with it; the member's text is
dedented by its own indentation; its lines are removed together with one following blank line, so no
double blank line remains.

## 8. Suppression

Nothing to build. Tests only: one `carburetor-disable-next-line` per new rule and one whole-file
directive in `native/tests/cli.rs`, following the `silenced*.tsx` fixture pattern.

## 9. Interaction with existing rules

- **H21 `no-handler-created-in-render`:** component JSX-attribute closures are excluded from R1 — no
  double report. DOM ones are R1's only.
- **H22 `require-bind-for-passed-method`:** R1 tells the author to use `@bind` when the method is
  passed as a value. H22 tracks prototype methods only; arrow fields are not flagged, so both targets
  are clean, `@bind` being the library's convention (H21/H22 docs).
- **H13 `no-lifecycle-class-property`:** lifecycle names are excluded from R2; no conflict with its
  fix (which turns lifecycle arrows into methods).
- **Render-scoped rules:** protected by the render-sensitive exclusion (§5.1). Residual, as for any
  hand-written render helper today: an extracted helper is not `render` for those rules. The
  documented `renderMethods` option is not consumed by the native crate (`config.rs`: "no rule
  consumes them yet") — a separate issue, out of scope.
- **Effect / transaction / computed rules:** protected by the callback exclusion (§5.1).
- **Conformance:** the bridge relays native diagnostics verbatim, so both sides agree by
  construction; the corpus still has to represent the new rules.

## 10. Wiring checklist — every item is guarded by an existing test

1. `native/Cargo.toml`/`Cargo.lock` — add `oxc_semantic = "=0.150.0"` (D2); `native/src/rules/allocations/*`,
   `support/closures.rs`, new constants in `support/bases.rs`; `mod allocations;` in `rules/mod.rs`
   and two `REGISTRY` rows — the array's length literal goes 22 → 24.
2. `native/src/config.rs::DEFAULT_SEVERITIES` +2 (`warn`, D3); the test
   `the_preset_has_22_bare_rules_and_one_off` → 24 (rename it).
3. `plugin/src/recommended.mts` +2.
4. `plugin/src/Rules/Allocations/{requireMethodForClosure,requireModuleFunction}.mts` —
   `nativeRule(id, description)`. `check:layout`: `plugin/src/Rules` goes 5 → 6 entries (limit 7).
5. `plugin/src/index.mts` — imports and `rules` entries.
6. `plugin/recommended.oxlintrc.json` +2 (hand-maintained; `packaging.test.ts` pins it to
   `RECOMMENDED`).
7. Repository `.oxlintrc.json` +2 — dogfooding.
8. Corpus: `plugin/__fixtures__/allocations.tsx`, each rule firing exactly once; add it to `CORPUS`
   in `__tests__/Native/conformance.test.ts`; both ids as `"error"` in
   `plugin/__fixtures__/oxlintrc.json` and `native/tests/fixtures/conformance.carburetorrc.json`;
   "every one of the 22 rules" → 24. The existing corpus files run with these rules force-enabled —
   check they do not start firing, adjust or accept.
9. `docs/hazards.md` — H29, H30 in the house format: Wrong / Why it is silent / Right / Rule /
   Detection / False positives.
10. `docs/rules.md` — two table rows; the intro sentence "Everything shipped is about the safety of
    carburetor logic" must name allocation hygiene as a low-level hazard, so the policy text stays
    true.
11. Rule counts in prose: `README.md` ("ships 22 rules"), `native/README.md` (benchmark table
    label), `.github/workflows/ci.yml` comment ("The 22 carburetor/* rules").
12. `CHANGELOG.md` entry.
13. `plugin/__fixtures__/consumer/app.tsx` via `packaging.test.ts` — confirm two new `warn` rules
    break no assertion.

## 11. Tests

- **Capture resolution** (`closures.rs`, exercising the `oxc_semantic`-backed resolver end to end):
  inner/outer shadowing; `var` and function-declaration hoisting; destructured parameters with
  defaults; `for…of` heads; `catch` parameters; a named function expression referring to itself; type
  positions ignored (`x: Foo`, `typeof foo` in a type); JSX component names; object shorthand; writes
  through `=`, `+=`, `++`, destructuring assignment; this-derived: plain chain, destructured, rest
  (no), computed (no), call (no), reassigned `let` (no).
- **Heritage walk** (D6): direct `extends AntiHookComponent`; two-level same-file chain
  (`Widget extends MyBase`, `MyBase extends AntiHookComponent`); chain stops at an imported base
  (documented, not a bug); a pathological same-file self-referencing/cyclic heritage does not hang
  (bounded-depth guard).
- **R1:** the TodoApp shape (report); a plain local captured by a callback (no); `DirectHelper` over
  a `const` local (report, parameter listed); `DirectHelper` over a later-reassigned local (no); a
  closure writing a capture (no); forwarder with the same parameters (forwarder message); forwarder
  with a plain-local argument (no); component JSX attribute (no — H21); DOM JSX attribute using only
  `this` (report); `useEffect`/`update`/`transaction`/`computed` callbacks (no); render closure
  calling `useCarburetor` or `getData` (no); class-field initializer closure (no); assigned to
  `this.x` (no); `function` expression using `this` (no); `arguments` (no); a nested class's
  members reported exactly once; a store class (`Carburetor`/`ResourceCarburetor`, no — D6 scope
  is component classes only); a same-file subclass of a component subclass (report — D6 heritage
  walk); a subclass of an imported base (no — documented limitation).
- **R2:** `.sort((a, b) => a - b)` in a method (report); `DirectHelper` with a passable local
  (report); callback capturing a plain local (no); members: `#private` without `this` (report),
  a **public** non-base method of a component with no `this` (report — D1 has no visibility split),
  a **protected** non-base method with no `this` (report), lifecycle name regardless of body (no),
  `useEffects`/other `AntiHookComponent` base-surface names regardless of body (no), any member of a
  store class — public, protected or private (no — store classes are out of D6's scope entirely),
  `implements` on the containing class (no), `override` (no), decorated (no), getter (no), uses a
  class type parameter (no), static member using `this` (no), `(): this` (no), `other.#x` (no); a
  subclass of a same-file `class MyBase extends AntiHookComponent` is still in scope (D6 heritage
  walk) and a subclass of an *imported* base is not (documented limitation, same as the other 22
  rules).
- **R2 fix** (the `fixed()` helper pattern from `no_lifecycle_class_property`: apply, re-parse,
  assert the rule no longer reports): plain method, arrow field, `async`, generic, TSDoc moves along,
  `export class`, `export default class`; bails: nested/expression class, name collision, shadowed
  reference, foreign reference form; several candidates converge across passes.
- **CLI:** suppression per rule; `--fix-dry-run` for R2.
- **Conformance and packaging:** §10.

## 12. Performance

- The resolver runs only for members that contain a candidate after exclusions; members without a
  nested function cost one shallow sub-visit.
- Declaration tables are per member; a linear scan by name is fine for member-sized code — switch to
  a map only if profiling says so.
- Re-run the `native/README.md` benchmark before and after. Acceptance: no regression beyond noise
  on the repository with both rules on. If the double analysis (§4) shows up, memoise per file
  inside the rules module.

## 13. Decisions — settled by the owner, 2026-09-23

| # | Decision | Final |
|---|---|---|
| D1 | Which R2 members are eligible | **No visibility split.** Public, protected and private are all eligible alike — "as soon as it's possible to extract, report it." The only exclusions are mechanical/framework-forced non-extractability: lifecycle names, `AntiHookComponent`'s own override-point surface (name lists, §7.2), `implements`, plus the always-mechanical exclusions (`constructor`, accessors, no-body, `override`, decorated, computed names). Store classes have no separate case because D6 removes them from scope entirely. |
| D2 | Scope resolution | **Add `oxc_semantic = "=0.150.0"`.** Owner: "конечно oxc_semantic! не будем же костылить то, что уже есть и протестировано" — but "взять необходимый минимум": one `Semantic` pass per file, used only for (a) reference→declaration resolution for capture analysis and (b) same-file heritage-chain resolution (D6). No type-checking, no cross-file resolution. First new non-`oxc_parser`/`oxc_ast` dependency in the crate — verify its exact 0.150.0 API at the start of LA-1 (§5.2). |
| D3 | Preset severity | `warn` for both — heuristic rules are `warn` by the preset's own policy, and these are low-level safety. Not raised as a question; no objection expected, revisit only if asked. |
| D4 | Library callback APIs (`useEffect`, `update`, `transaction`, `computed`) | Excluded from candidacy — keeps error-level rules able to read those bodies. Not raised as a question; technical necessity, not a preference. |
| D5 | JSX attribute closures | Component elements stay H21's; DOM elements are R1's. Not raised as a question; avoids a double report, not a preference. |
| D6 | Which classes | **Component classes only** — `COMPONENT_BASES`, direct or transitive through same-file classes (owner: "только классы компонентов ... и наши классы (от нас унаследовавшиеся)"). `CARBURETOR_BASES` (store classes) explicitly OUT of scope for both rules — narrower than the original recommendation, which had included stores. Both class-declaration and arrow-class-field member forms count equally (owner: "и стрелочный и обычные классы") — already the plan's intent for §7.2's candidate definition, now confirmed. |
| D7 | Plain prototype methods in R2 (no per-instance allocation) | Include — asked for explicitly, and "does not use the class, does not belong in it" is simple to explain; the message adapts (§7.2). Superseded in spirit by D1's broader "no visibility split," which already implies this. |
| D8 | Names | `require-method-for-closure`, `require-module-function`; category `allocations`; H29, H30. Not raised as a question; no objection expected, revisit only if asked. |

D1/D2/D6 were the genuine forks and were put to the owner directly; D3/D4/D5/D7/D8 were technical
necessities or directly implied by the original request, decided here and stated for the record —
flag if any of them should have been asked instead.

## 14. Tasks

| Task | Content | Blocked by |
|---|---|---|
| LA-0 | Settle D1–D8 with the owner; update this plan | — |
| LA-1 | `support/closures.rs`: candidates, exclusions, resolver, class dependency, usage, render propagation; unit tests | LA-0 |
| LA-2 | R1 rule + unit tests + native wiring (module, `REGISTRY`, `DEFAULT_SEVERITIES`) | LA-1 |
| LA-3 | R2 detection (closures + members) + unit tests + native wiring | LA-1 |
| LA-4 | R2 member autofix + fix tests + CLI `--fix-dry-run` test | LA-3 |
| LA-5 | JS bridge wrappers, `index.mts`, presets, repo config, conformance corpus, packaging checks, suppression CLI tests | LA-2, LA-3 |
| LA-6 | Docs: H29/H30, `rules.md` rows and intro, rule counts in prose, `CHANGELOG.md` | LA-2, LA-3 |
| LA-7 | Dogfooding on the repository (triage every hit: refactor or justified directive), benchmark, full verification | LA-4, LA-5, LA-6 |

LA-2 and LA-3 both add a row to `REGISTRY` and `DEFAULT_SEVERITIES` (22 → 23 → 24): run them one
after the other, or hand-merge those two lines when run in parallel worktrees.

Full verification for every task that touches `native/`: `cargo test` and `cargo build --release`
in `native/` (the conformance test runs the release binary), then from the root `npm run build`,
`npm run typecheck`, `npm run lint`, `npm run check:layout`, `npx rstest run`.
