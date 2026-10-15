//! H32: a callback handed to `this.update` that captures the surrounding function's bindings.
//!
//! Every call of the method builds the callback again, and the capture freezes values the next
//! call will not see. `update` is exactly `mutate(this.draft)` plus `emitUpdate()` in a finally,
//! so the callback can be replaced by writes to `this.draft` and a direct `this.emitUpdate()` —
//! wrapped in try/finally when the body can throw. A forgotten `emitUpdate` is what
//! `require-emit-after-draft-write` catches, and a callback that uses nothing around it is not
//! this rule's finding at all: that one is a module-level function, which
//! `require-module-function` reports.

use std::collections::HashSet;

use oxc_ast::ast::{CallExpression, Expression, IdentifierReference, Program, ThisExpression};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{ReferenceId, Semantic};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{called_on_this, member_call_name, unwrap_expression};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-closure-in-update";

/// Whether `inner` lies inside `outer`, which is the only identity a node has here.
fn contains(outer: Span, inner: Span) -> bool {
    inner.start >= outer.start && inner.end <= outer.end
}

/// The message for one reportable callback: what rebuilding it costs, and what to write instead.
fn message(captured: &[String], member: Option<&str>) -> String {
    let cadence = match member {
        Some(name) => format!("on every call of `{name}`"),
        None => String::from("on every call"),
    };

    let names = captured
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "the callback passed to `this.update` is rebuilt {cadence} and captures {names} — \
         `update` is exactly `mutate(this.draft)` plus `emitUpdate()` in a finally. Write to \
         `this.draft` directly and call `this.emitUpdate()` afterwards, wrapped in try/finally \
         when the body can throw; a forgotten emit is what require-emit-after-draft-write catches."
    )
}

/// Whether the expression is one of the literal callback shapes `update` accepts.
fn is_callback_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// The identifier references and `this` occurrences one callback body reads.
#[derive(Default)]
struct Reads {
    /// What each reference was spelled as, and the semantic reference to resolve it by — the
    /// visitor's methods take anonymously-lifetimed nodes, so the references are copied out.
    identifiers: Vec<(String, Option<ReferenceId>)>,
    uses_this: bool,
}

impl Visit<'_> for Reads {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'_>) {
        self.identifiers
            .push((identifier.name.to_string(), identifier.reference_id.get()));

        walk::walk_identifier_reference(self, identifier);
    }

    fn visit_this_expression(&mut self, expression: &ThisExpression) {
        self.uses_this = true;

        walk::walk_this_expression(self, expression);
    }
}

/// Reads one callback body — arrow or function expression, already unwrapped.
fn reads(callback: &Expression<'_>) -> Reads {
    let mut reads = Reads::default();

    match callback {
        Expression::ArrowFunctionExpression(arrow) => {
            reads.visit_arrow_function_expression(arrow);
        }
        Expression::FunctionExpression(function) => {
            reads.visit_function(function, ScopeFlags::Function);
        }
        _ => {}
    }

    reads
}

/// One pass over one file: the `this.update(<literal callback>)` calls inside store methods whose
/// callback captures a binding of the method around it.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    /// The callbacks already reported, which keeps a nested `this.update` inside a reported
    /// callback from being read as a capture of its own.
    handled: HashSet<Span>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// The callback's captures of the enclosing member: parameters and locals the method declares,
    /// plus `this`. A binding the callback declares itself, a module-level name and an unresolved
    /// global are not captures — a callback free of them is `require-module-function`'s finding.
    fn captures(&self, callback: &Expression<'_>, member: Span) -> Vec<String> {
        let callback_span = callback.span();
        let reads = reads(callback);
        let mut captured: Vec<String> = Vec::new();

        if reads.uses_this {
            captured.push(String::from("this"));
        }

        for (name, reference) in reads.identifiers {
            let symbol = reference
                .and_then(|id| self.semantic.scoping().get_reference(id).symbol_id());

            let Some(symbol) = symbol else {
                continue;
            };

            let declaration = self.semantic.symbol_declaration(symbol).kind().span();

            if contains(callback_span, declaration) || !contains(member, declaration) {
                continue;
            }

            captured.push(name);
        }

        captured
    }
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        // A nested `this.update` inside a reported callback is covered by that report's captures.
        if self.handled.iter().any(|span| contains(*span, call.span)) {
            return;
        }

        if !context.in_carburetor
            || !called_on_this(&call.callee)
            || member_call_name(&call.callee) != Some("update")
        {
            return;
        }

        // `this.update(ref)` hands over a function the author already controls; only a literal
        // arrow or function expression is one this method rebuilds on every call.
        let Some(argument) = call.arguments.first().and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };

        let callback = unwrap_expression(argument);

        if !is_callback_expression(callback) {
            return;
        }

        let Some(member) = context.member_span else {
            return;
        };

        let captured = self.captures(callback, member);

        if captured.is_empty() {
            return;
        }

        self.handled.insert(call.span);

        let message = message(&captured, context.member.as_deref());

        self.diagnostics
            .push(report(self.source, callback.span().start, RULE, message));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    walk_rule(
        program,
        Check {
            source,
            semantic: &semantic,
            handled: HashSet::new(),
            diagnostics: Vec::new(),
        },
    )
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
fn a_capturing_update_callback_is_reported_with_its_captures_named() {
    let source = store(
        "    rename(name) {\n        this.update(() => {\n            \
         this.draft.name = name;\n        });\n    }",
    );

    let found = diagnose(&source, check);

    assert_eq!(lines(&found), [3]);

    let message = &found[0].message;

    assert!(message.contains("rebuilt on every call of `rename`"), "{message}");
    assert!(message.contains("captures `this`, `name`"), "{message}");
}

#[test]
fn a_callback_capturing_nothing_is_not_reported() {
    // The callback declares its own binding, so nothing of the method around it is captured:
    // this one is a module-level function, which `require-module-function` reports.
    let source = store(
        "    touch() {\n        this.update((draft) => {\n            \
         draft.name = 'x';\n        });\n    }",
    );

    assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
}

#[test]
fn a_module_level_helper_is_not_a_capture() {
    let source = format!(
        "const helper = (draft: {{name: string}}) => {{ draft.name = 'x'; }};\n\n{}",
        store("    touch() {\n        this.update((draft) => helper(draft));\n    }")
    );

    assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
}

#[test]
fn a_nested_update_inside_a_reported_callback_is_covered_by_that_report() {
    let source = store(
        "    rename(name) {\n        this.update(() => {\n            \
         this.draft.name = name;\n            this.update(() => {\n                \
         this.draft.extra = name;\n            });\n        });\n    }",
    );

    assert_eq!(lines(&diagnose(&source, check)), [3]);
}

#[test]
fn a_callback_handed_over_as_a_value_is_not_rebuilt_here() {
    let source = store("    touch() {\n        this.update(this.clear);\n    }");

    assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
}

#[test]
fn an_update_outside_a_carburetor_class_is_not_this_rules_finding() {
    let source = "class Widget {\n    touch(name: string) {\n        \
                  this.update(() => {\n            this.draft.name = name;\n        });\n    }\n}\n";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}
}

