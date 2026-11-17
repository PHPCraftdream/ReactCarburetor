//! A selector or effect built anew on every render and handed to `useStoreEffect`.
//!
//! `useStoreEffect(name, store, select, effect)` keeps `[store, select, effect]` as its effect's
//! dependencies, and `useEffects` runs on every render. A function written inline (an arrow, a
//! function expression, a `.bind(...)` result, or a function a constant of the same method holds)
//! is a new object each time, so every render unsubscribes, subscribes again and runs the effect
//! once more with no previous value: an autosave saves on every render, a request repeats.
//! Nothing fails. A module-level function or a method (`this.save`) keeps its identity.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, Function, Program, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::{called_on_this, member_call_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-inline-store-effect";

const MESSAGE: &str = "this function is created anew on every render, and useStoreEffect keeps \
    it as a dependency: each render unsubscribes, subscribes again and runs the effect once more \
    with no previous value. Pass a module-level function or a method (this.save) instead.";

/// Whether an expression builds a new function each time it is evaluated.
fn builds_function(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::CallExpression(call) => member_call_name(&call.callee) == Some("bind"),
        Expression::ParenthesizedExpression(inner) => builds_function(&inner.expression),
        _ => false,
    }
}

/// The names a function body binds to a function it builds: `const select = (s) => s.text`, or a
/// nested `function select() {}`.
#[derive(Default)]
struct LocalFunctions<'a> {
    names: HashSet<&'a str>,
    depth: usize,
}

impl<'a> Visit<'a> for LocalFunctions<'a> {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(identifier), Some(init)) =
            (&declarator.id, &declarator.init)
        {
            if builds_function(init) {
                self.names.insert(identifier.name.as_str());
            }
        }

        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if self.depth > 0 {
            if let Some(id) = &function.id {
                self.names.insert(id.name.as_str());
            }
        }

        self.depth += 1;
        walk::walk_function(self, function, flags);
        self.depth -= 1;
    }
}

/// The `this.useStoreEffect` calls of one function body, judged against its local functions.
struct Calls<'s, 'a> {
    source: &'s Source<'s>,
    locals: &'s HashSet<&'a str>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Calls<'_, 'a> {
    fn unstable(&self, expression: &Expression<'a>) -> bool {
        builds_function(expression)
            || matches!(expression, Expression::Identifier(identifier)
                if self.locals.contains(identifier.name.as_str()))
    }

    fn inspect(&mut self, argument: Option<&Argument<'a>>) {
        if let Some(expression) = argument.and_then(Argument::as_expression) {
            if self.unstable(expression) {
                self.diagnostics.push(report(
                    self.source,
                    expression.span().start,
                    RULE,
                    MESSAGE.to_string(),
                ));
            }
        }
    }
}

impl<'a> Visit<'a> for Calls<'_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) == Some("useStoreEffect") && called_on_this(&call.callee)
        {
            // (name, store, select, effect) for a store, (name, computed, effect) for a computed.
            match call.arguments.len() {
                4 => {
                    self.inspect(call.arguments.get(2));
                    self.inspect(call.arguments.get(3));
                }
                3 => self.inspect(call.arguments.get(2)),
                _ => {}
            }
        }

        walk::walk_call_expression(self, call);
    }

    // A nested function is checked with its own locals when the outer pass reaches it.
    fn visit_function(&mut self, _function: &Function<'a>, _flags: ScopeFlags) {}
}

/// One pass over one file: every function body that calls `this.useStoreEffect`.
struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Visit<'a> for Check<'_> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if let Some(body) = &function.body {
            let mut locals = LocalFunctions {
                depth: 1,
                ..LocalFunctions::default()
            };

            for statement in &body.statements {
                locals.visit_statement(statement);
            }

            let mut calls = Calls {
                source: self.source,
                locals: &locals.names,
                diagnostics: Vec::new(),
            };

            for statement in &body.statements {
                calls.visit_statement(statement);
            }
            self.diagnostics.append(&mut calls.diagnostics);
        }

        walk::walk_function(self, function, flags);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>, _bases: &Bases) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        diagnostics: Vec::new(),
    };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    fn component(body: &str) -> String {
        format!("class A extends AntiHookComponent {{\n    useEffects() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn an_inline_selector_and_effect_are_reported() {
        let source = component(
            "        this.useStoreEffect('save', store, (s) => s.text, (text) => save(text));",
        );

        assert_eq!(lines(&diagnose(&source, check)), [3, 3]);
    }

    #[test]
    fn a_function_expression_and_a_bind_are_reported() {
        let source = component(concat!(
            "        this.useStoreEffect('a', store, selectText, function (t) { save(t); });\n",
            "        this.useStoreEffect('b', computed, this.save.bind(this));",
        ));

        assert_eq!(lines(&diagnose(&source, check)), [3, 4]);
    }

    #[test]
    fn a_function_held_by_a_constant_of_the_method_is_reported() {
        let source = component(concat!(
            "        const select = (s) => s.text;\n",
            "        function run(t) { save(t); }\n",
            "        this.useStoreEffect('save', store, select, run);",
        ));

        assert_eq!(lines(&diagnose(&source, check)), [5, 5]);
    }

    #[test]
    fn module_functions_methods_and_props_keep_their_identity() {
        let source = format!(
            "const selectText = (s) => s.text;\n{}",
            component(concat!(
                "        const store = this.props.draft;\n",
                "        this.useStoreEffect('save', store, selectText, this.scheduleSave);\n",
                "        this.useStoreEffect('total', this.props.total, this.props.onTotal);",
            ))
        );

        assert!(diagnose(&source, check).is_empty());
    }

    #[test]
    fn a_foreign_use_store_effect_and_other_arities_are_not_this_rule() {
        let source = component(concat!(
            "        other.useStoreEffect('a', store, (s) => s, (v) => v);\n",
            "        this.useStoreEffect(...args);",
        ));

        assert!(diagnose(&source, check).is_empty());
    }
}
