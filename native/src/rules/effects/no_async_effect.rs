//! H14: an effect whose body is asynchronous.
//!
//! Whatever an effect returns is treated as its cleanup. An `async` function returns a promise,
//! which is not a function, so the cleanup is dropped: the effect can never tear itself down, and
//! the abort it was supposed to perform on unmount never happens. Nothing warns, because returning
//! nothing is legal too. The supported shape is a synchronous body that starts the work and returns
//! a real cleanup, usually an `AbortController` the cleanup aborts. See docs/hazards.md, H14.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrowFunctionBody, CallExpression, Expression, Function, Program, Statement,
    VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-async-effect";

const MESSAGE: &str = "an async effect body returns a promise, and the engine treats what an effect \
    returns as its cleanup: the promise is not a function, so this effect can never clean up after \
    itself and nothing is aborted on unmount. Start the work in a synchronous body and return a \
    cleanup, for example one that aborts an AbortController.";

/// `() => loadEverything()`, or `() => { return loadEverything(); }` — the call the body hands
/// back, when identifying by name is possible at all.
fn returned_identifier_call<'a>(body: &'a ArrowFunctionBody<'a>) -> Option<&'a str> {
    let call = match body {
        ArrowFunctionBody::CallExpression(call) => Some(call.as_ref()),
        ArrowFunctionBody::FunctionBody(function_body) => match function_body.statements.as_slice() {
            [Statement::ReturnStatement(statement)] => match &statement.argument {
                Some(Expression::CallExpression(call)) => Some(call.as_ref()),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }?;

    match &call.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Names of async functions declared anywhere in this file.
    async_locals: HashSet<String>,
    /// An effect body that returns a named call, and the offset to report if it turns out async.
    suspects: Vec<(u32, String)>,
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if function.r#async {
            if let Some(id) = &function.id {
                self.async_locals.insert(id.name.to_string());
            }
        }

        walk::walk_function(self, function, flags);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let is_async_function = match &declarator.init {
            Some(Expression::ArrowFunctionExpression(f)) => f.r#async,
            Some(Expression::FunctionExpression(f)) => f.r#async,
            _ => false,
        };

        if is_async_function {
            if let Some(identifier) = declarator.id.get_binding_identifier() {
                self.async_locals.insert(identifier.name.to_string());
            }
        }

        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) == Some("useEffect") {
            match call.arguments.first() {
                Some(Argument::ArrowFunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(self.source, body.span.start, RULE, MESSAGE.to_string()));
                }
                Some(Argument::FunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(self.source, body.span.start, RULE, MESSAGE.to_string()));
                }
                Some(Argument::ArrowFunctionExpression(body)) => {
                    if let Some(callee) = returned_identifier_call(&body.body) {
                        self.suspects.push((body.span.start, callee.to_string()));
                    }
                }
                _ => {}
            }
        }

        walk::walk_call_expression(self, call);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check =
        Check { source, diagnostics: Vec::new(), async_locals: HashSet::new(), suspects: Vec::new() };

    check.visit_program(program);

    for (offset, callee) in &check.suspects {
        if check.async_locals.contains(callee) {
            check.diagnostics.push(report(source, *offset, RULE, MESSAGE.to_string()));
        }
    }

    check.diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_async_arrow_body_is_reported() {
        let source = "this.useEffect(async () => {\n    await load();\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn an_async_function_expression_body_is_reported() {
        let source = "this.useEffect(async function () {\n    await load();\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_synchronous_body_with_a_real_cleanup_is_correct() {
        let source = "useEffect(() => {\n    const c = new AbortController();\n    load(c.signal);\n\n    return () => c.abort();\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_concise_body_returning_an_async_local_is_reported() {
        let source = "async function loadEverything() {}\n\nthis.useEffect(() => loadEverything(), 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_block_body_returning_an_async_local_is_reported() {
        let source =
            "const loadEverything = async () => {};\n\nthis.useEffect(() => {\n    return loadEverything();\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_concise_body_returning_a_synchronous_call_is_correct() {
        let source = "function subscribe() {\n    return () => {};\n}\n\nuseEffect(() => subscribe(), 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
