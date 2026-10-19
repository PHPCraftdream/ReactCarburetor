//! The names the rules recognise carburetor code by.
//!
//! Detection is syntactic in both implementations: neither a JavaScript plugin nor this crate has
//! type information, so a class is a component because of the name in its `extends` clause. The
//! consequence is deliberate and documented — a project-local subclass is invisible until it is
//! configured — and the lists here have to stay equal to the JavaScript ones, which the conformance
//! corpus is what checks.

/// The base classes a component is recognised by.
pub const COMPONENT_BASES: [&str; 2] = ["AntiHookComponent", "ScopedAntiHookComponent"];

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{Class, Program};
use oxc_ast_visit::{walk, Visit};

use crate::rules::support::names::super_class_name;

/// The recognised base classes of one run: the built-in lists plus the additions a project
/// configures through the `componentBases` / `storeBases` keys of `.carburetorrc.json`.
///
/// Recognition stays syntactic, so a project-local base has to be spelled out here — the
/// documented limitation every rule shares, made configurable instead of fixed.
#[derive(Clone)]
pub struct Bases {
    component: Vec<String>,
    store: Vec<String>,
}

impl Default for Bases {
    fn default() -> Bases {
        Bases {
            component: COMPONENT_BASES
                .iter()
                .map(|base| String::from(*base))
                .collect(),
            store: CARBURETOR_BASES
                .iter()
                .map(|base| String::from(*base))
                .collect(),
        }
    }
}

impl Bases {
    /// The run's lists, extended with whatever the configuration adds.
    pub fn from_config(component: &[String], store: &[String]) -> Bases {
        let mut bases = Bases::default();

        bases.component.extend(component.iter().cloned());
        bases.store.extend(store.iter().cloned());

        bases
    }

    /// Whether `name` names a recognised component base.
    pub fn is_component(&self, name: &str) -> bool {
        self.component.iter().any(|base| base == name)
    }

    /// Whether `name` names a recognised store base.
    pub fn is_store(&self, name: &str) -> bool {
        self.store.iter().any(|base| base == name)
    }

    /// The component base names, for text prefilters.
    pub fn components(&self) -> &[String] {
        &self.component
    }

    /// The store base names, for text prefilters.
    pub fn stores(&self) -> &[String] {
        &self.store
    }
}

/// The same-file class heritage: each named class to the base name its `extends` clause spells.
///
/// Recognition is transitive within a file: a project-local `class Rows extends Layout` is
/// component code when `Layout` extends a recognised base in the same file. An imported base
/// stops the walk — the documented limitation every rule in this crate shares.
pub struct ClassChains {
    super_of: HashMap<String, String>,
}

/// Collects the heritage of every named class in the file, one pass.
struct ChainCollector {
    super_of: HashMap<String, String>,
    /// Class names declared without an `extends` clause, to catch a later same-name subclass.
    plain: HashSet<String>,
    /// Names declared more than once with different heritage.
    ambiguous: HashSet<String>,
}

impl<'a> Visit<'a> for ChainCollector {
    fn visit_class(&mut self, class: &Class<'a>) {
        if let Some(id) = &class.id {
            let super_name = class
                .heritage
                .as_ref()
                .and_then(|heritage| super_class_name(&heritage.expression));
            let name = id.name.to_string();

            // Heritage is resolved by spelling, not by binding: a name declared twice with
            // different heritage (two scopes) is dropped so neither declaration is guessed.
            match super_name {
                Some(next) => match self.super_of.get(&name) {
                    Some(known) if known != next => {
                        self.ambiguous.insert(name);
                    }
                    Some(_) => {}
                    None if self.plain.contains(&name) => {
                        self.ambiguous.insert(name);
                    }
                    None => {
                        self.super_of.insert(name, String::from(next));
                    }
                },
                None if self.super_of.contains_key(&name) => {
                    self.ambiguous.insert(name);
                }
                None => {
                    self.plain.insert(name);
                }
            }
        }

        walk::walk_class(self, class);
    }
}

/// A real chain is a handful deep; the ceiling bounds the pathological cycle the same way the
/// semantic-based walk in `support/closures` bounds its own.
const MAX_HERITAGE_DEPTH: usize = 8;

impl ClassChains {
    /// Builds the chain index for one file.
    pub fn build(program: &Program<'_>) -> ClassChains {
        let mut collector = ChainCollector {
            super_of: HashMap::new(),
            plain: HashSet::new(),
            ambiguous: HashSet::new(),
        };

        collector.visit_program(program);

        for name in &collector.ambiguous {
            collector.super_of.remove(name);
        }

        ClassChains {
            super_of: collector.super_of,
        }
    }

    /// Whether `class` extends a base `is_base` recognises, directly or through same-file
    /// subclasses. The walk starts at the class's own `extends` clause, so an anonymous class
    /// expression follows its chain like a named one.
    pub fn reaches(&self, class: &Class<'_>, is_base: impl Fn(&str) -> bool) -> bool {
        let Some(mut name) = class
            .heritage
            .as_ref()
            .and_then(|heritage| super_class_name(&heritage.expression))
        else {
            return false;
        };

        for _ in 0..MAX_HERITAGE_DEPTH {
            if is_base(name) {
                return true;
            }

            let Some(next) = self.super_of.get(name) else {
                return false;
            };

            name = next.as_str();
        }

        false
    }
}

/// The base classes a store is recognised by.
///
/// `ResourceCache` is one: it holds per-key state and publishes to subscribers exactly like a
/// store does, so the store rules must see its subclasses too.
pub const CARBURETOR_BASES: [&str; 3] = ["Carburetor", "ResourceCarburetor", "ResourceCache"];

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

/// The calls whose callback arguments are off-limits for closure extraction.
///
/// Each name protects an existing rule that inspects the callback body in place: `useEffect`
/// protects `no-async-effect` and `require-effect-deps`, `update` protects the draft tracking in
/// `support/walk.rs` and `no-async-transaction`, `transaction` protects `no-async-transaction`,
/// `computed` protects `no-computed-get-in-computed`. Moving a closure out from under one of those
/// rules would blind it, which is worse than the allocation being reported.
pub const EXCLUDED_CALLBACK_APIS: [&str; 4] = ["useEffect", "update", "transaction", "computed"];

/// The tracked-data APIs a render-executing closure may not call.
///
/// A closure that runs during render and calls one of these is excluded from closure extraction:
/// moving it out of render would make `no-use-carburetor-outside-render` report a false positive
/// and would hide the read or write from `no-get-data-in-render` / `no-store-write-in-render`.
pub const RENDER_TRACKED_APIS: [&str; 8] = [
    "useCarburetor",
    "useComputed",
    "useResource",
    "getData",
    "getEntry",
    "emitUpdate",
    "emitSoon",
    "emitByKey",
];
