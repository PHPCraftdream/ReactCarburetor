//! H6: a method that writes through `draft` and never publishes.
//!
//! The data changes and nobody is notified, so the interface keeps showing the previous value until
//! some unrelated write happens to wake the same subscribers. Development reports this at runtime,
//! but only for code paths that actually executed; the rule sees the ones that did not.
//! See docs/hazards.md, H6.

use std::collections::{HashMap, HashSet, VecDeque};

use oxc_ast::ast::{CallExpression, Expression, Program};
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::chain::ChainRoot;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-emit-after-draft-write";

const MESSAGE: &str = "this writes through draft but never publishes: the data changes while nobody \
    is notified, so the interface keeps showing the previous value. Use this.update(draft => ...), \
    which mutates and publishes in one step, or call this.emitUpdate() before returning.";

/// The calls that publish an update.
const EMIT_METHODS: [&str; 3] = ["emitUpdate", "emitSoon", "emitByKey"];

/// Methods that run while an update is already being published.
///
/// `preEmit` is called by `emitUpdate` itself, right before subscribers are notified — deriving
/// state there is what it is for, and calling `emitUpdate()` inside it would recurse. Whatever
/// `preEmit` delegates to is in the same position, which is why the exemption follows `this.x()`
/// calls outward from these roots.
const PUBLISHING_CONTEXT: [&str; 1] = ["preEmit"];

/// The first unpublished write found in one method.
struct Write {
    offset: u32,
    member: Option<String>,
}

struct Check<'s> {
    source: &'s Source<'s>,
    /// Method span -> its first unpublished write. Keyed by span, the only stable identity a
    /// method has when the same name can appear in two classes of one file.
    writes: HashMap<Span, Write>,
    /// The methods that do publish.
    publishes: HashSet<Span>,
    /// Method name -> the methods of the same class it calls, for spreading the exemption.
    calls_from: HashMap<String, HashSet<String>>,
}

impl<'s> Check<'s> {
    /// The names that never have to publish, following calls out of a publishing context.
    fn exempt(&self) -> HashSet<String> {
        let mut exempt: HashSet<String> =
            PUBLISHING_CONTEXT.iter().map(|name| name.to_string()).collect();
        let mut queue: VecDeque<String> = exempt.iter().cloned().collect();

        while let Some(name) = queue.pop_front() {
            let Some(called) = self.calls_from.get(&name) else {
                continue;
            };

            for callee in called {
                if exempt.insert(callee.clone()) {
                    queue.push_back(callee.clone());
                }
            }
        }

        exempt
    }
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        let exempt = self.exempt();
        let mut diagnostics: Vec<Diagnostic> = Vec::new();

        for (member, write) in &self.writes {
            if self.publishes.contains(member) {
                continue;
            }

            if write.member.as_ref().is_some_and(|name| exempt.contains(name)) {
                continue;
            }

            diagnostics.push(report(self.source, write.offset, RULE, MESSAGE.to_string()));
        }

        diagnostics
    }

    fn mutation(&mut self, root: &ChainRoot<'_, 'a>, span: Span, context: &Context) {
        // A write inside `update(draft => ...)` is published when the callback returns.
        if !context.in_carburetor || context.in_update || !root.is_this_property("draft") {
            return;
        }

        let Some(member) = context.member_span else {
            return;
        };

        self.writes
            .entry(member)
            .or_insert_with(|| Write { offset: span.start, member: context.member.clone() });
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        let Some(method) = member_call_name(&call.callee) else {
            return;
        };

        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return;
        };

        if !matches!(callee.object, Expression::ThisExpression(_)) {
            return;
        }

        let Some(member) = context.member_span else {
            return;
        };

        if EMIT_METHODS.contains(&method) {
            self.publishes.insert(member);

            return;
        }

        // `this.x()` — remember the edge so an exemption can travel along it.
        let Some(caller) = context.member.clone() else {
            return;
        };

        self.calls_from.entry(caller).or_default().insert(method.to_string());
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut diagnostics = walk_rule(
        program,
        Check {
            source,
            writes: HashMap::new(),
            publishes: HashSet::new(),
            calls_from: HashMap::new(),
        },
    );

    // The findings come out of a map, so they are ordered here rather than left to chance: the
    // whole-run sort is by file and line, which would leave two reports in one file arbitrary.
    diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a class body in a store, so each test reads as the code it is about.
    fn store(body: &str) -> String {
        format!("class Store extends Carburetor {{\n{body}\n}}\n")
    }

    #[test]
    fn a_write_that_never_publishes_is_reported() {
        let source = store("    rename(name) {\n        this.draft.name = name;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_write_followed_by_an_emit_is_correct() {
        let source =
            store("    rename(name) {\n        this.draft.name = name;\n        this.emitUpdate();\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_write_inside_update_publishes_itself() {
        let source = store(
            "    rename(name) {\n        this.update((draft) => {\n            \
             draft.name = name;\n        });\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn emit_soon_counts_as_publishing() {
        let source =
            store("    rename(name) {\n        this.draft.name = name;\n        this.emitSoon();\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn pre_emit_is_already_publishing() {
        let source = store("    preEmit = () => {\n        this.draft.count = 1;\n    };");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn what_pre_emit_delegates_to_is_exempt_as_well() {
        // The exemption travels along `this.x()` calls, because a helper called from preEmit is in
        // the same position: publishing there would recurse.
        let source = store(
            "    preEmit = () => {\n        this.countStats();\n    };\n\n    \
             countStats = () => {\n        this.draft.count = 1;\n    };",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn only_the_first_write_of_a_method_is_reported() {
        let source = store(
            "    rename(a, b) {\n        this.draft.a = a;\n        this.draft.b = b;\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn each_method_is_judged_on_its_own() {
        let source = store(
            "    good(name) {\n        this.draft.name = name;\n        this.emitUpdate();\n    }\n\n    \
             bad(name) {\n        this.draft.name = name;\n    }",
        );

        // Line 8: the write inside `bad`, while the identical write in `good` is published.
        assert_eq!(lines(&diagnose(&source, check)), [8]);
    }
}
