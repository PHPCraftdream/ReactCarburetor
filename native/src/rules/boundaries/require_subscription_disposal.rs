//! H20: a subscription whose id is thrown away.
//!
//! The carburetor holds the callback, and the callback holds everything it closed over, for the
//! lifetime of the store. Nothing fails: memory grows and the callback keeps firing after the thing
//! it served is gone. `watch(paths, callback)` returns a disposer instead, which makes the cleanup
//! impossible to forget; components need neither, since `useCarburetor` subscribes and
//! `componentWillUnmount` releases.
//!
//! A subscription made with an explicit `{id}` is not reported: the caller kept a handle and can
//! release or replace it by that id, which is exactly how the engine subscribes components and
//! computed values. See docs/hazards.md, H20.

use oxc_ast::ast::{CallExpression, Expression, ObjectPropertyKind, Program, PropertyKey, Statement};
use oxc_ast_visit::{walk, Visit};

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-subscription-disposal";

const MESSAGE: &str = "this subscription's id is discarded, so it can never be released: the store \
    keeps the callback, and everything it closed over, for the lifetime of the process. Use \
    watch(paths, callback), which returns a disposer, or keep the id and unsubscribe.";

/// Whether the subscription was given a stable id, which is a handle to release it by.
fn has_stable_id(call: &CallExpression<'_>) -> bool {
    let Some(Expression::ObjectExpression(options)) = call.arguments.get(1).and_then(|a| a.as_expression())
    else {
        return false;
    };

    options.properties.iter().any(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => {
            matches!(&property.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "id")
        }
        _ => false,
    })
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Whether the call currently being visited sits directly in a statement's expression, which
    /// is the only position where its return value is provably discarded.
    in_expression_statement: bool,
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_statements(&mut self, statements: &oxc_allocator::Vec<'a, Statement<'a>>) {
        for statement in statements {
            if let Statement::ExpressionStatement(statement) = statement {
                self.in_expression_statement = true;
                self.visit_expression(&statement.expression);
                self.in_expression_statement = false;
            } else {
                self.visit_statement(statement);
            }
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.in_expression_statement
            && member_call_name(&call.callee) == Some("subscribe")
            && !has_stable_id(call)
        {
            self.diagnostics.push(report(self.source, call.span.start, RULE, MESSAGE.to_string()));
        }

        // Any nested call (an argument, a callback body) is not itself an expression statement.
        let outer = std::mem::take(&mut self.in_expression_statement);
        walk::walk_call_expression(self, call);
        self.in_expression_statement = outer;
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check { source, diagnostics: Vec::new(), in_expression_statement: false };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_discarded_subscription_is_reported() {
        assert_eq!(lines(&diagnose("store.subscribe(callback);\n", check)), [1]);
    }

    #[test]
    fn a_subscription_with_a_stable_id_is_correct() {
        let source = "store.subscribe(callback, {id: 'row-1'});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_kept_return_value_is_a_handle() {
        assert_eq!(lines(&diagnose("const id = store.subscribe(callback);\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn subscribe_with_reads_but_no_id_is_still_discarded() {
        let source = "store.subscribe(callback, {reads: ['a']});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }
}
