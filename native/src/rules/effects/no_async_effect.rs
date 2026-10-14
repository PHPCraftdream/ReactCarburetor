//! H14: an effect whose body is asynchronous.
//!
//! Whatever an effect returns is treated as its cleanup. An `async` function returns a promise,
//! which is not a function, so the cleanup is dropped: the effect can never tear itself down, and
//! the abort it was supposed to perform on unmount never happens. Nothing warns, because returning
//! nothing is legal too. The supported shape is a synchronous body that starts the work and returns
//! a real cleanup, usually an `AbortController` the cleanup aborts. Only calls on `this` are
//! matched — `jobs.useEffect(...)` on a foreign object is not an effect. A name returned by the
//! body is resolved lexically: the innermost scope that declares it decides, so a local binding
//! shadowing an outer async function is not reported. See docs/hazards.md, H14.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrowFunctionBody, ArrowFunctionExpression, CallExpression, Expression, Function,
    Program, Statement, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::names::{called_on_this, member_call_name};
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

/// One function-level scope: blocks like `if`/`for` do not get their own frame, which is precise
/// enough for the shadowing cases this rule cares about.
struct ScopeFrame {
    /// Every name declared in this scope, async or not — the innermost declaration shadows outer
    /// ones either way.
    names: HashSet<String>,
    /// The subset of `names` that is async; only these are worth reporting.
    async_names: HashSet<String>,
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Lexical scope stack; the innermost frame is last.
    scopes: Vec<ScopeFrame>,
}

impl<'s> Check<'s> {
    /// Walks the stack top-down; the first frame declaring `name` wins, so a local binding
    /// shadowing an outer async function is respected. An undeclared name is never reported,
    /// matching how unknown callees are treated.
    fn is_async_local(&self, name: &str) -> bool {
        self.scopes.iter().rev().find(|frame| frame.names.contains(name)).is_some_and(|frame| {
            frame.async_names.contains(name)
        })
    }

    fn record(&mut self, name: &str, r#async: bool) {
        let frame = self.scopes.last_mut().expect("program frame always present");
        frame.names.insert(name.to_string());
        if r#async {
            frame.async_names.insert(name.to_string());
        }
    }
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        // A function declaration's name belongs to the enclosing scope, so record it before
        // pushing the body's frame; sync declarations are recorded too, so they shadow outer
        // async ones.
        if let Some(id) = &function.id {
            self.record(id.name.as_str(), function.r#async);
        }

        self.scopes.push(ScopeFrame { names: HashSet::new(), async_names: HashSet::new() });
        walk::walk_function(self, function, flags);
        self.scopes.pop();
    }

    fn visit_arrow_function_expression(&mut self, expression: &ArrowFunctionExpression<'a>) {
        self.scopes.push(ScopeFrame { names: HashSet::new(), async_names: HashSet::new() });
        walk::walk_arrow_function_expression(self, expression);
        self.scopes.pop();
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let init_asyncness = match &declarator.init {
            Some(Expression::ArrowFunctionExpression(f)) => Some(f.r#async),
            Some(Expression::FunctionExpression(f)) => Some(f.r#async),
            _ => None,
        };

        // Sync function initializers are recorded too, so their name shadows outer async ones.
        if let Some(r#async) = init_asyncness {
            if let Some(identifier) = declarator.id.get_binding_identifier() {
                self.record(identifier.name.as_str(), r#async);
            }
        }

        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if called_on_this(&call.callee) && member_call_name(&call.callee) == Some("useEffect") {
            match call.arguments.get(1) {
                Some(Argument::ArrowFunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(self.source, body.span.start, RULE, MESSAGE.to_string()));
                }
                Some(Argument::FunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(self.source, body.span.start, RULE, MESSAGE.to_string()));
                }
                Some(Argument::ArrowFunctionExpression(body)) => {
                    if let Some(callee) = returned_identifier_call(&body.body) {
                        // Resolve here: the stack matches the call's lexical position exactly.
                        if self.is_async_local(callee) {
                            self.diagnostics
                                .push(report(self.source, body.span.start, RULE, MESSAGE.to_string()));
                        }
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
        Check { source, diagnostics: Vec::new(), scopes: vec![ScopeFrame {
            names: HashSet::new(),
            async_names: HashSet::new(),
        }] };

    check.visit_program(program);

    check.diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_async_arrow_body_is_reported() {
        let source = "this.useEffect('load', async () => {\n    await load();\n}, []);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn an_async_function_expression_body_is_reported() {
        let source = "this.useEffect('load', async function () {\n    await load();\n}, []);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_synchronous_body_with_a_real_cleanup_is_correct() {
        let source = "this.useEffect('load', () => {\n    const c = new AbortController();\n    load(c.signal);\n\n    return () => c.abort();\n}, []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_concise_body_returning_an_async_local_is_reported() {
        let source = "async function loadEverything() {}\n\nthis.useEffect('load', () => loadEverything(), []);\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_block_body_returning_an_async_local_is_reported() {
        let source =
            "const loadEverything = async () => {};\n\nthis.useEffect('load', () => {\n    return loadEverything();\n}, []);\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_concise_body_returning_a_synchronous_call_is_correct() {
        let source =
            "function subscribe() {\n    return () => {};\n}\n\nthis.useEffect('load', () => subscribe(), []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_call_on_a_foreign_object_is_not_an_effect() {
        let source = "const jobs = {useEffect: (n, f) => f()};\njobs.useEffect('sync', async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_local_arrow_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\nclass Widget extends AntiHookComponent {\n    useEffects() {\n        const subscribe = () => () => {};\n\n        this.useEffect('listen', () => subscribe(), []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_local_sync_declaration_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\nclass Widget extends AntiHookComponent {\n    useEffects() {\n        function subscribe() {\n            return () => {};\n        }\n\n        this.useEffect('listen', () => subscribe(), []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_local_async_arrow_shadowing_an_outer_sync_function_is_reported() {
        let source = "function subscribe() {\n    return () => {};\n}\n\nclass Widget extends AntiHookComponent {\n    useEffects() {\n        const subscribe = async () => {};\n\n        this.useEffect('listen', () => subscribe(), []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [9]);
    }

    #[test]
    fn an_undeclared_callee_is_not_reported() {
        let source = "this.useEffect('x', () => ghost(), []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_block_body_returning_an_async_function_through_this_is_reported() {
        let source = "async function loadAll() {}\n\nthis.useEffect('load', () => {\n    return loadAll();\n}, []);\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }
}
