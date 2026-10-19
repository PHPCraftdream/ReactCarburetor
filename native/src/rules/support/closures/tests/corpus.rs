//! Shared sources both allocation rules' tests run over: one source per syntactic corner.

/// Every source a nested-function or class-member analysis must agree with its oracle on.
pub(in crate::rules) const CORPUS: &[&str] = &[
    // Recursion by function name, and by the const an arrow is bound to.
    "function outer() { const f = () => outer(); return f; }",
    "const outer = () => { const g = () => outer(); return g(); }; outer();",
    // Type-only references to a type declared in a nested function.
    "function make() { const h = () => { type X = number; const a: X = 1; const f = () => a; \
     return f; }; return h; }",
    // A variable written after its initialiser.
    "function outer() { let c = 0; const f = () => { c = 1; }; return f; }",
    "function outer() { let c = 0; const g = () => c; c = 1; const f = () => g; return f; }",
    // A value derived off `this`.
    "class C { m() { const { id } = this.data; const h = () => id; return h; } }",
    // Parameters, including a destructured pattern with a default.
    "function outer(a: number) { const f = ({ b, c = 1 }: { b: number; c?: number }) => a + b + \
     (c ?? 0); return f; }",
    // Shadowing: the nested function declares the same name.
    "function outer(x: number) { const f = () => { const x = 1; const g = () => x; return g; }; \
     return f; }",
    // `var` hoisted out of a nested block, read outside it.
    "function outer() { const f = () => { { var v = 1; } const g = () => v; return g; }; \
     return f; }",
    // A catch parameter captured by a nested function.
    "function outer() { try {} catch (e) { const f = () => e; } }",
    // A labelled statement inside a function.
    "function outer() { outer_loop: for (;;) { break outer_loop; } const f = () => 1; \
     return f; }",
    // Private names: a private field read and a `#x in` test.
    "class C { #x = 1; m() { const f = () => this.#x; const g = () => #x in this; \
     return [f, g]; } }",
    // An implicit `arguments`, unresolved because nothing declares it.
    "function outer() { const f = () => arguments; return f; }",
    // `new.target` inside an arrow.
    "function outer() { const f = () => new.target; return f; }",
    // A class expression inside a function; its method's `this` belongs to the method.
    "function outer() { const K = class { x = 1; m() { return this.x; } }; const f = () => \
     new K().x; return f; }",
    // A class expression with a type parameter used inside its own method.
    "function outer() { const K = class<T> { v: T; m(): T { const f = () => this.v; \
     return this.v; } }; return K; }",
    // A class declaration inside a function.
    "function outer() { class K { v = 1; m() { const f = () => this.v; return f; } } \
     return K; }",
    // JSX tags as references, with a component-prop callback.
    "function Outer() { const local = 1; return <Comp onClick={() => local} />; }",
    // `typeof x` in a type position is not a runtime reference.
    "function outer() { const x = 1; let t: typeof x; const f = () => x; return f; }",
    // Exports of both shapes.
    "export function outer() { const f = () => 1; return f; }",
    "export const arrow = () => { const g = () => 1; return g; };",
    // Module-level references: depth 0, and read from depth 1.
    "const g = () => 1; function f() { return g(); }",
    "const m = 1; function outer() { const f = () => m; return f; }",
    // Nesting depth 3, capturing from every level.
    "function a() { const va = 1; function b() { const vb = 2; function c() { const vc = 3; \
     const f = () => va + vb + vc; return f; } return c; } return b; }",
    // Arrow pyramid, depth 8.
    "const p8 = () => () => () => () => () => () => () => () => 0;",
    // Function pyramid, depth 8.
    "function f1() { function f2() { function f3() { function f4() { function f5() { \
     function f6() { function f7() { function f8() { return 0; } return f8; } return f7; } \
     return f6; } return f5; } return f4; } return f3; } return f2; }",
    // An IIFE, whose callee is excluded but whose insides are not.
    "const result = (() => { const f = () => 1; return f; })();",
    // A tracked-API call inside a function.
    "function outer() { const f = () => { getData(store); return 1; }; return f; }",
    // A function handed to a tracked-API call is inside one of its arguments.
    "function outer() { const handler = getData(() => { const f = () => 1; return f; }); \
     return handler; }",
    // A callback protected by an excluded API; only the direct argument is protected.
    "function outer() { store.update(() => { const f = () => 1; f(); }); }",
    // A generator and an async function.
    "function* gen() { const f = () => 1; yield f; }",
    "async function outer() { const f = async () => await Promise.resolve(1); return f; }",
    // A method as the root; functions inside it are ordinary candidates.
    "class C { m() { const f = () => 1; return f; } }",
    // A getter, a setter, and a field holding an arrow.
    "class C { get x() { const f = () => 1; return f; } set x(v: number) { const g = () => v; } \
     field = () => { const h = () => 1; return h; }; }",
    // `this` through a chain of arrows: the mark climbs the whole chain.
    "function outer() { const f = () => { const g = () => { const h = () => this; return h; }; \
     return g; }; return f; }",
    // `this` in a plain nested function binds there and does not climb.
    "function outer() { function inner() { this.x; } const f = () => inner; return f; }",
    // `super` in a method, captured by a nested arrow.
    "class Base { m() {} } class C extends Base { m() { const f = () => super.m(); return f; } }",
    // The class's type parameter, used inside a method's nested functions.
    "class C<T> { m(v: T) { const f = () => { const g = () => { const x: T = v; return x; }; \
     return g; }; return f; } }",
    // `useCallback` and `useMemo` around a component-prop callback.
    "function Outer() { const local = 1; return <Comp onClick={useCallback(() => local, [])} \
     onChange={useMemo(() => () => local, [])} />; }",
    // A function expression that recurses on its own bound name.
    "const handler = function named() { return named; };",
    // A class field read off `this` by a nested function.
    "class C { flag = true; m() { const f = () => this.flag; return f; } }",
    // A pure forwarder arrow inside a method.
    "class C { v = 1; m(x: number) { return x + this.v; } n() { const f = () => this.m(2); \
     return f; } }",
    // A field whose arrow holds a nested pure forwarder.
    "class C { m() { return 1; } h = () => { const f = () => this.m(); return f; }; }",
    // A field arrow whose nested arrow writes a `let` after its initialiser.
    "class C { h = () => { let c = 0; const g = () => { c = c + 1; return c; }; return g; }; }",
    // A decorator on a method, with an arrow inside it.
    "class C { @dec m() { const f = () => 1; return f; } }",
    // A computed method key, capturing its parameter from an arrow.
    "class C { ['k'](v: number) { const f = () => v; return f; } }",
    // A static block holding an arrow.
    "class C { static s = 1; static { const f = () => 1; } }",
    // An exported default function with an arrow inside.
    "export default function outer() { const f = () => 1; return f; }",
    // A capture through a parameter's default value.
    "function outer(a: number) { const f = (b = a) => b; return f; }",
    // A local component used as a JSX tag, capturing from its prop callback.
    "function Outer() { const name = 1; const Foo = () => name; return <Foo />; }",
    // A named function expression recursing on its inner name.
    "const handler = function named(n: number): number { return n <= 1 ? 1 : named(n - 1); };",
    // A block scope inside a function: scope depth is not function depth.
    "function outer() { { let x = 1; const g = () => x; } return 0; }",
    // A catch parameter shadowing the enclosure's parameter, captured by an arrow.
    "function outer(e: number) { try {} catch (e) { const f = () => e; } }",
    // A `let` written after its initialiser, with a read in the writer.
    "function outer() { let c = 0; const f = () => (c += 1); return f; }",
    // Own-symbol capture through a nested arrow chain: the entry dies on its owner frame.
    "function outer() { const f = () => () => f; return f; }",
    // A real capture of an own symbol, alongside a recursion on it.
    "function outer() { const f = () => { const g = () => f; return g; }; return f; }",
    // A declared function recursed on from a nested arrow.
    "function outer() { function g() { return () => g; } return g; }",
    // Mutual recursion between two arrows: neither is free of the enclosure.
    "function outer() { const f = () => g(); const g = () => f(); return [f, g]; }",
    // A chain where only the outermost function is free of captures.
    "function g() { const f = () => 1; const h = () => f; return h; }",
    // An own symbol at module depth, which never counts as a capture.
    "const f = () => () => f;",
    // A named function expression recursed on from a nested arrow.
    "function outer() { const h = function named() { return () => named; }; return h; }",
    // Exports do not change the folded minimum.
    "export function outer(x: number) { const independent = () => 1; \
     const dependent = () => x; return [independent, dependent]; }",
    // A module binding read from a nested arrow.
    "const moduleValue = 1; function outer(x: number) { const dependent = () => x + moduleValue; \
     return dependent; }",
    // A helper declaration inside a render method, called in place.
    "class C extends AntiHookComponent { render() { function helper() { return 1; } \
     return helper(); } }",
    // A constructor member, whose arrow is an ordinary candidate.
    "class C { constructor() { const f = () => 1; } }",
    // A class declaration between site frames, with `this` and tracked data inside it.
    "function wrap() { function outer() { const K = class { m() { this.x; } }; \
     const f = () => new K(); return f; } return outer; }",
    // Declarations and lexical marks between site frames, inside a tracked call.
    "class C { m() { const f = () => { function d() { arguments; new.target; this.z; \
     getData(store); } return d; }; return f; } }",
];
