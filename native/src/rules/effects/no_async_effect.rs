//! H14: an effect whose body is asynchronous.
//!
//! Whatever an effect returns is treated as its cleanup. An `async` function returns a promise,
//! which is not a function, so the cleanup is dropped: the effect can never tear itself down, and
//! the abort it was supposed to perform on unmount never happens. Nothing warns, because returning
//! nothing is legal too. The supported shape is a synchronous body that starts the work and returns
//! a real cleanup, usually an `AbortController` the cleanup aborts. Only calls on `this` are
//! matched — `jobs.useEffect(...)` on a foreign object is not an effect. A callee named in the
//! body is resolved to its binding through the semantic model; only a binding that declares an
//! async function — an async function declaration or a variable initialized to an async function
//! — is reported, so parameters, imports, and non-function initializers of the same name are
//! not. See docs/hazards.md, H14.

use oxc_ast::ast::{
    Argument, ArrowFunctionBody, CallExpression, Expression, IdentifierReference, Program,
    Statement,
};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Semantic, SymbolId};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{called_on_this, member_call_name, referenced_symbol};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-async-effect";

const MESSAGE: &str =
    "an async effect body returns a promise, and the engine treats what an effect \
    returns as its cleanup: the promise is not a function, so this effect can never clean up after \
    itself and nothing is aborted on unmount. Start the work in a synchronous body and return a \
    cleanup, for example one that aborts an AbortController.";

/// `() => loadEverything()`, or `() => { return loadEverything(); }` — the identifier the body
/// hands back, when identifying it at all is possible.
fn returned_identifier_call<'a>(
    body: &'a ArrowFunctionBody<'a>,
) -> Option<&'a IdentifierReference<'a>> {
    let call = match body {
        ArrowFunctionBody::CallExpression(call) => Some(call.as_ref()),
        ArrowFunctionBody::FunctionBody(function_body) => match function_body.statements.as_slice()
        {
            [Statement::ReturnStatement(statement)] => match &statement.argument {
                Some(Expression::CallExpression(call)) => Some(call.as_ref()),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }?;

    match &call.callee {
        Expression::Identifier(identifier) => Some(identifier),
        _ => None,
    }
}

/// Only a declaration of an async function counts: parameters, imports, catch parameters and
/// non-function initializers are synchronous no matter what their name suggests.
fn is_async_binding(semantic: &Semantic<'_>, symbol: SymbolId) -> bool {
    match semantic.symbol_declaration(symbol).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::VariableDeclarator(declarator) => {
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|id| id.symbol_id.get() == Some(symbol))
                && match &declarator.init {
                    Some(Expression::ArrowFunctionExpression(f)) => f.r#async,
                    Some(Expression::FunctionExpression(f)) => f.r#async,
                    _ => false,
                }
        }
        _ => false,
    }
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Visit<'a> for Check<'a, 's> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if called_on_this(&call.callee) && member_call_name(&call.callee) == Some("useEffect") {
            match call.arguments.get(1) {
                Some(Argument::ArrowFunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(
                        self.source,
                        body.span.start,
                        RULE,
                        MESSAGE.to_string(),
                    ));
                }
                Some(Argument::FunctionExpression(body)) if body.r#async => {
                    self.diagnostics.push(report(
                        self.source,
                        body.span.start,
                        RULE,
                        MESSAGE.to_string(),
                    ));
                }
                Some(Argument::ArrowFunctionExpression(body)) => {
                    if let Some(callee) = returned_identifier_call(&body.body) {
                        if let Some(symbol) = referenced_symbol(callee, self.semantic) {
                            // Only a binding declaring an async function is reported; an
                            // unresolved name resolves to no symbol at all and is left alone.
                            if is_async_binding(self.semantic, symbol) {
                                self.diagnostics.push(report(
                                    self.source,
                                    body.span.start,
                                    RULE,
                                    MESSAGE.to_string(),
                                ));
                            }
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
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source,
    semantic: &Semantic<'a>,
) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        semantic,
        diagnostics: Vec::new(),
    };

    check.visit_program(program);

    check
        .diagnostics
        .sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

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

    #[test]
    fn a_parameter_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\nclass Widget extends AntiHookComponent {\n    useEffects(subscribe: () => () => void) {\n        this.useEffect('listen', () => subscribe(), []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_non_function_initializer_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\nclass Widget extends AntiHookComponent {\n    useEffects() {\n        const subscribe = makeSubscription;\n\n        this.useEffect('listen', () => subscribe(), []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_destructured_parameter_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\nfunction effects({subscribe}: {subscribe: () => () => void}) {\n    this.useEffect('listen', () => subscribe(), []);\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_catch_parameter_shadowing_an_outer_async_function_is_correct() {
        let source = "async function subscribe() {}\n\ntry {\n    load();\n} catch (subscribe) {\n    this.useEffect('listen', () => subscribe(), []);\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_imported_binding_of_the_same_name_is_not_reported() {
        let source = "import {subscribe} from './subscriptions';\n\nthis.useEffect('listen', () => subscribe(), []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
