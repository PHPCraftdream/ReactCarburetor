//! An effect dependency read from a store with `getData()`.
//!
//! `useEffects` runs after the commit, so it compares its dependencies only when the component
//! re-renders for some other reason. A value taken with `getData()` changes without re-rendering the
//! component, so the effect does not run again when the store changes; it seems to work only while
//! `render` happens to read the same field. `useStoreEffect` watches the selection instead.
//!
//! Inside a `useEffects` method, a `this.useEffect` dependency is reported when it calls `getData()`
//! itself, names a constant of the same method whose initializer did, or is the whole dependency
//! array held in such a constant.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, MethodDefinition, Program,
    VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::{called_on_this, member_call_name, property_key_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-store-read-in-effect-deps";

const MESSAGE: &str = "this dependency is read with getData(), so it is compared only when \
    something else re-renders the component: the effect does not run again when the store \
    changes. Use this.useStoreEffect(name, store, select, effect), which watches the selection \
    and runs the effect on each change.";

/// Whether an expression calls `getData()` anywhere inside it.
#[derive(Default)]
struct ReadsData {
    found: bool,
}

impl<'a> Visit<'a> for ReadsData {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) == Some("getData") {
            self.found = true;

            return;
        }

        walk::walk_call_expression(self, call);
    }
}

/// Whether `expression` calls `getData()` anywhere inside it.
fn reads_data(expression: &Expression<'_>) -> bool {
    let mut reads = ReadsData::default();

    reads.visit_expression(expression);

    reads.found
}

/// The leftmost identifier of a member chain, the name a tainted constant is used under.
fn root_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => root_name(&member.object),
        Expression::ComputedMemberExpression(member) => root_name(&member.object),
        _ => None,
    }
}

/// The constants of one `useEffects` body whose initializer read a store with `getData()`.
#[derive(Default)]
struct Tainted<'a> {
    names: HashSet<&'a str>,
}

impl<'a> Visit<'a> for Tainted<'a> {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if declarator.init.as_ref().is_some_and(reads_data) {
            match &declarator.id {
                BindingPattern::BindingIdentifier(identifier) => {
                    self.names.insert(identifier.name.as_str());
                }
                BindingPattern::ObjectPattern(pattern) => {
                    for property in &pattern.properties {
                        if let BindingPattern::BindingIdentifier(identifier) = &property.value {
                            self.names.insert(identifier.name.as_str());
                        }
                    }
                }
                _ => {}
            }
        }

        walk::walk_variable_declarator(self, declarator);
    }
}

/// The `this.useEffect` calls of one `useEffects` body.
struct Calls<'s, 'a> {
    source: &'s Source<'s>,
    tainted: &'s HashSet<&'a str>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Calls<'_, 'a> {
    /// Whether one dependency expression comes from `getData()`.
    fn comes_from_data(&self, expression: &Expression<'a>) -> bool {
        reads_data(expression)
            || root_name(expression).is_some_and(|name| self.tainted.contains(name))
    }
}

impl<'a> Visit<'a> for Calls<'_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) == Some("useEffect") && called_on_this(&call.callee) {
            // `useEffect(name, body, deps)` or `useEffect(effect, deps)`: the array is the last argument.
            match call.arguments.last() {
                Some(Argument::ArrayExpression(array)) => {
                    for element in &array.elements {
                        if let Some(expression) = element.as_expression() {
                            if self.comes_from_data(expression) {
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
                Some(argument) => {
                    if let Some(expression) = argument.as_expression() {
                        if matches!(expression, Expression::Identifier(_))
                            && self.comes_from_data(expression)
                        {
                            self.diagnostics.push(report(
                                self.source,
                                expression.span().start,
                                RULE,
                                MESSAGE.to_string(),
                            ));
                        }
                    }
                }
                None => {}
            }
        }

        walk::walk_call_expression(self, call);
    }
}

/// One pass over one file: every `useEffects` method, whatever class it is in.
struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Visit<'a> for Check<'_> {
    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        if property_key_name(&method.key) == Some("useEffects") {
            if let Some(body) = &method.value.body {
                let mut tainted = Tainted::default();

                tainted.visit_function_body(body);

                let mut calls = Calls {
                    source: self.source,
                    tainted: &tainted.names,
                    diagnostics: Vec::new(),
                };

                calls.visit_function_body(body);
                self.diagnostics.append(&mut calls.diagnostics);

                return;
            }
        }

        walk::walk_method_definition(self, method);
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

    #[test]
    fn a_dependency_read_with_get_data_is_reported() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    useEffects() {\n",
            "        this.useEffect('save', save, [this.props.draft.getData().text]);\n",
            "    }\n",
            "}\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_constant_read_with_get_data_taints_its_uses_and_a_held_array() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    useEffects() {\n",
            "        const {theme} = settings.getData();\n",
            "        const data = store.getData();\n",
            "        const deps = [store.getData().lang];\n",
            "        this.useEffect('theme', applyTheme, [theme]);\n",
            "        this.useEffect(applyLang, [data.lang, this.props.id]);\n",
            "        this.useEffect('held', run, deps);\n",
            "    }\n",
            "}\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [6, 7, 8]);
    }

    #[test]
    fn props_and_untainted_values_are_fine() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    useEffects() {\n",
            "        const url = this.props.url;\n",
            "        this.useEffect('connect', () => connect(url), [url, this.props.store]);\n",
            "        this.useStoreEffect('theme', settings, selectTheme, applyTheme);\n",
            "    }\n",
            "    render() { return this.props.store.getData().title; }\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn get_data_outside_use_effects_is_not_this_rule() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    componentDidMount() { this.useEffect('x', run, [store.getData().a]); }\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }
}
