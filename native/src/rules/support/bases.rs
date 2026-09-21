//! The names the rules recognise carburetor code by.
//!
//! Detection is syntactic in both implementations: neither a JavaScript plugin nor this crate has
//! type information, so a class is a component because of the name in its `extends` clause. The
//! consequence is deliberate and documented — a project-local subclass is invisible until it is
//! configured — and the lists here have to stay equal to the JavaScript ones, which the conformance
//! corpus is what checks.

/// The base classes a component is recognised by.
pub const COMPONENT_BASES: [&str; 2] = ["AntiHookComponent", "ScopedAntiHookComponent"];

/// The base classes a store is recognised by.
pub const CARBURETOR_BASES: [&str; 2] = ["Carburetor", "ResourceCarburetor"];

/// The members whose body is render code.
pub const RENDER_METHODS: [&str; 1] = ["render"];

/// Methods that change a value the tracking proxies cannot wrap.
///
/// The list is the heuristic: without type information a rule cannot tell a `Map` from an object of
/// your own that happens to have a `set` method, which is why the rule using it is a warning.
pub const MUTATING_METHODS: [&str; 12] = [
    "set",
    "add",
    "delete",
    "clear",
    "setTime",
    "setDate",
    "setMonth",
    "setFullYear",
    "setHours",
    "setMinutes",
    "setSeconds",
    "setMilliseconds",
];

/// Array methods that change the array they are called on rather than returning a new one.
pub const ARRAY_MUTATORS: [&str; 9] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];

/// Methods that run their callback immediately, while the expression around them evaluates.
///
/// `ids.map(id => ...)` happens during the render, so that callback is render code; `onClick={() =>
/// ...}` is not. Nothing in the syntax separates the two beyond who receives the function, so the
/// synchronous receivers are named rather than guessed.
pub const SYNCHRONOUS_CALLBACKS: [&str; 12] = [
    "map",
    "flatMap",
    "filter",
    "forEach",
    "reduce",
    "reduceRight",
    "some",
    "every",
    "find",
    "findIndex",
    "findLast",
    "sort",
];
