//! H3: a source read inside a `computed(...)` body without going through its reader.
//!
//! The body receives a `read` function, and that function is what registers dependencies. A direct
//! `get()` or `getData()` bypasses it, so the computed records no dependency on what it just read,
//! is never invalidated, and returns a stale value for the rest of the process's life. This was a
//! real bug in this engine's own history and is the most silent hazard in the catalogue: the value
//! is correct the first time and wrong forever after. See docs/hazards.md, H3.
//!
//! This rule keeps its own walk rather than using the shared one: what it needs to know is which
//! `computed(...)` call encloses a node and what that body named its reader, and nothing about
//! renders.

use oxc_ast::ast::{Argument, CallExpression, Expression, FormalParameters, Program};
use oxc_ast_visit::{walk, Visit};

use crate::rules::report;
use crate::rules::support::names::{call_receiver_name, member_call_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-computed-get-in-computed";

/// The factories that take a computed body.
const COMPUTED_FACTORIES: [&str; 1] = ["computed"];

/// The reader parameter a computed body was handed, when it named one.
fn reader_name<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    let Some(Argument::ArrowFunctionExpression(body)) = call.arguments.first() else {
        return first_parameter_name_of_function(call);
    };

    first_parameter_name(&body.params)
}

/// The same question for a body written as `function (read) { ... }`.
fn first_parameter_name_of_function<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    match call.arguments.first() {
        Some(Argument::FunctionExpression(body)) => first_parameter_name(&body.params),
        _ => None,
    }
}

/// The name of the first parameter, when it is a plain binding rather than a pattern.
fn first_parameter_name<'a>(parameters: &'a FormalParameters<'a>) -> Option<&'a str> {
    parameters
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|identifier| identifier.name.as_str())
}

/// Whether a call is `computed(...)`.
fn is_computed_factory(callee: &Expression<'_>) -> bool {
    match callee {
        Expression::Identifier(identifier) => {
            COMPUTED_FACTORIES.contains(&identifier.name.as_str())
        }
        _ => false,
    }
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// The readers of the `computed(...)` calls currently enclosing the walk, innermost last. An
    /// entry is `None` when the body named no reader, which still makes the body a computed body.
    /// Owned, because a borrow out of the arena would have to outlive the visit that reads it.
    readers: Vec<Option<String>>,
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let entered = is_computed_factory(&call.callee);

        if entered {
            self.readers.push(reader_name(call).map(str::to_string));
        } else {
            self.check(call);
        }

        walk::walk_call_expression(self, call);

        if entered {
            self.readers.pop();
        }
    }
}

impl<'s> Check<'s> {
    /// Reports a read that bypasses the reader of the computed body it sits in.
    fn check(&mut self, call: &CallExpression<'_>) {
        if self.readers.is_empty() {
            return;
        }

        let Some(name) = member_call_name(&call.callee) else {
            return;
        };

        if name != "get" && name != "getData" {
            return;
        }

        // A keyed lookup is somebody else's `get`, not a computed's.
        if name == "get" && !call.arguments.is_empty() {
            return;
        }

        // Reading through the reader is the correct form and must stay unreported.
        let receiver = call_receiver_name(&call.callee);

        if receiver.is_some() && self.readers.iter().rev().any(|reader| reader.as_deref() == receiver) {
            return;
        }

        let message = format!(
            "{name}() inside a computed body bypasses the reader it was given, so no dependency is \
             registered and this computed will keep returning its first value forever. Read through \
             the reader instead: computed(read => read(source))."
        );

        self.diagnostics.push(report(self.source, call.span.start, RULE, message));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut rule = Check { source, diagnostics: Vec::new(), readers: Vec::new() };

    rule.visit_program(program);

    rule.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_direct_read_inside_a_computed_is_reported() {
        let source = "const total = computed((read) => {\n    return store.getData().x;\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_read_through_the_reader_is_correct() {
        let source = "const total = computed((read) => {\n    return read(store).x;\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_computed_read_through_the_reader_is_correct() {
        // `read.get()` is not how the reader is used, but the receiver is the reader, so the rule
        // stays out of it — the same call on anything else is the hazard.
        let source = "const total = computed((read) => {\n    return read.get();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_zero_argument_get_on_another_source_is_reported() {
        let source = "const total = computed((read) => {\n    return other.get() + read(store).x;\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_keyed_get_is_somebody_elses_get() {
        let source = "const total = computed((read) => {\n    return cache.get('key');\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn the_same_read_outside_a_computed_is_left_alone() {
        assert_eq!(lines(&diagnose("const x = store.getData();\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn a_nested_computed_keeps_its_own_reader() {
        // The inner body names a different reader; reading the outer one from it is still a read
        // that registers no dependency on the inner computed.
        let source = "const total = computed((read) => computed((inner) => read(store).x + inner(other).y));\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
