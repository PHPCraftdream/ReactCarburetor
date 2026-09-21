//! H17: an asynchronous body given to `transaction()` or `update()`.
//!
//! Both are open only while the body runs synchronously. At the first `await` the body returns a
//! promise, the batch closes, and every write after the await is delivered on its own — so the
//! batching silently does nothing, and in `update()`'s case the later writes are never published at
//! all. Development reports both at runtime; the rule catches the paths that never ran. The fix is
//! always the same shape: do the asynchronous work first, then wrap the synchronous block of writes.
//! See docs/hazards.md, H17.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrowFunctionExpression, AwaitExpression, CallExpression, Expression, Function,
    Program,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-async-transaction";

/// The name a batching call was made under, whether `transaction(...)` or `this.update(...)`.
fn batching_name(call: &CallExpression<'_>) -> Option<&'static str> {
    if let Expression::Identifier(identifier) = &call.callee {
        if identifier.name == "transaction" {
            return Some("transaction");
        }
    }

    (member_call_name(&call.callee) == Some("update")).then_some("update")
}

/// The batching call currently enclosing the walk, if the function being visited is its body.
struct Enclosing {
    span: Span,
    name: &'static str,
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    reported: HashSet<Span>,
    /// The batching call whose body the walk is currently inside, if any — only an `await` in the
    /// body itself closes the batch; one in a nested function belongs to that function's own
    /// timeline, which is why entering any function clears this.
    enclosing: Option<Enclosing>,
}

impl<'s> Check<'s> {
    fn report_once(&mut self, span: Span, name: &str) {
        if !self.reported.insert(span) {
            return;
        }

        let message = format!(
            "{name}() is open only while its body runs synchronously: at the first await the body \
             returns a promise and the batch closes, so the writes that follow are delivered \
             separately — or, for update(), never published at all. Do the asynchronous work first, \
             then {name}() the synchronous writes."
        );

        self.diagnostics.push(report(self.source, span.start, RULE, message));
    }
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let Some(name) = batching_name(call) else {
            walk::walk_call_expression(self, call);

            return;
        };

        let is_async_body = matches!(
            call.arguments.first(),
            Some(Argument::ArrowFunctionExpression(body)) if body.r#async
        ) || matches!(
            call.arguments.first(),
            Some(Argument::FunctionExpression(body)) if body.r#async
        );

        if is_async_body {
            self.report_once(call.span, name);
        }

        let outer = self.enclosing.replace(Enclosing { span: call.span, name });

        walk::walk_call_expression(self, call);

        self.enclosing = outer;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        // A nested function's awaits belong to its own timeline, not the batching call's.
        let outer = self.enclosing.take();

        walk::walk_arrow_function_expression(self, arrow);

        self.enclosing = outer;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let outer = self.enclosing.take();

        walk::walk_function(self, function, flags);

        self.enclosing = outer;
    }

    fn visit_await_expression(&mut self, expression: &AwaitExpression<'a>) {
        if let Some(enclosing) = &self.enclosing {
            let (span, name) = (enclosing.span, enclosing.name);

            self.report_once(span, name);
        }

        walk::walk_await_expression(self, expression);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check =
        Check { source, diagnostics: Vec::new(), reported: HashSet::new(), enclosing: None };

    check.visit_program(program);

    check.diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_async_transaction_body_is_reported() {
        let source = "transaction(async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn an_await_in_a_nested_iife_does_not_close_the_outer_batch() {
        // The IIFE is a function boundary of its own, same as the JS rule's findEnclosingFunction.
        let source = "transaction(() => {\n    void (async () => {\n        await load();\n    })();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_async_update_body_is_reported() {
        let source = "this.update(async (draft) => {\n    await load();\n    draft.x = 1;\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_synchronous_transaction_is_correct() {
        let source = "transaction(() => {\n    store.a.set(1);\n    store.b.set(2);\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_in_a_nested_function_belongs_to_its_own_timeline() {
        let source =
            "transaction(() => {\n    const later = async () => {\n        await load();\n    };\n\n    later();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn each_offending_call_is_reported_only_once() {
        let source = "this.update(async (draft) => {\n    await a();\n    await b();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }
}
