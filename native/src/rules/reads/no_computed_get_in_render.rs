//! H2: a computed read with `get()` while a component renders.
//!
//! `get()` returns the memoized value and registers no subscription, so the component never hears
//! that the derived value changed — the same silent freeze as reading a store with `getData()`.
//!
//! A computed's `get()` takes no arguments, which is what tells it apart from `Map.get(key)`,
//! `FormData.get(name)` and every other `get` that needs a key. A zero-argument `get()` on
//! something that is not a computed is this rule's only false positive, and it is rare in render.
//! See docs/hazards.md, H2.

use oxc_ast::ast::{CallExpression, Program};

use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::rules::report;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-computed-get-in-render";

const MESSAGE: &str = "get() in render returns the derived value without subscribing to it, so this \
    component will not re-render when it changes. Use this.useComputed(computed), which subscribes \
    to the value rather than to its inputs.";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        // A keyed lookup is somebody else's `get`, not a computed's.
        if !context.in_render || !call.arguments.is_empty() {
            return;
        }

        if member_call_name(&call.callee) != Some("get") {
            return;
        }

        self.diagnostics.push(report(self.source, call.span.start, RULE, MESSAGE.to_string()));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new() })
}
