//! Opt-in component architecture: React hooks belong outside hook-free components.

use oxc_ast::ast::{CallExpression, Expression, FunctionBody, Program, ReturnStatement};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, Semantic};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::{build_semantic, is_component_class};
use crate::{Diagnostic, Source};

use bindings::{is_hook_name, ReactBindings};

/// React import identities: which names came from the react module, resolved by symbol.
mod bindings {
    use std::collections::HashMap;

    use oxc_ast::ast::{
        Argument, BindingPattern, CallExpression, Expression, ImportDeclarationSpecifier,
        ImportOrExportKind, ModuleExportName, Program, PropertyKey, Statement,
    };
    use oxc_ast::AstKind;
    use oxc_ast_visit::{walk, Visit};
    use oxc_semantic::{ReferenceFlags, Semantic, SymbolId};

    /// React reserves `use` and use-prefixed camel-case exports for hook-style functions.
    pub(super) fn is_hook_name(name: &str) -> bool {
        name == "use"
            || name
                .strip_prefix("use")
                .and_then(|tail| tail.as_bytes().first())
                .is_some_and(|first| first.is_ascii_uppercase() || first.is_ascii_digit())
    }

    #[derive(Clone, Copy)]
    enum Binding<'a> {
        Namespace,
        Named(&'a str),
    }

    pub(super) struct ReactBindings<'a> {
        values: HashMap<SymbolId, Binding<'a>>,
    }

    /// Static `CommonJS` provenance; a locally shadowed require is not the module loader.
    fn requires_react(call: &CallExpression<'_>, semantic: Option<&Semantic<'_>>) -> bool {
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        if identifier.name != "require" || call.arguments.len() != 1 {
            return false;
        }
        if !matches!(&call.arguments[0], Argument::StringLiteral(value) if value.value == "react") {
            return false;
        }
        semantic.is_none_or(|semantic| {
            identifier
                .reference_id
                .get()
                .and_then(|id| semantic.scoping().get_reference(id).symbol_id())
                .is_none()
        })
    }

    struct RequiresReact {
        found: bool,
    }

    impl<'a> Visit<'a> for RequiresReact {
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            self.found |= requires_react(call, None);
            if !self.found {
                walk::walk_call_expression(self, call);
            }
        }
    }

    impl<'a> ReactBindings<'a> {
        /// Parsed module names handle escaped spellings without raw-source heuristics.
        pub(super) fn has_react_source(program: &Program<'_>) -> bool {
            if program.body.iter().any(|statement| {
                matches!(statement,
            Statement::ImportDeclaration(import) if import.source.value == "react"
                && import.import_kind == ImportOrExportKind::Value)
            }) {
                return true;
            }
            let mut scan = RequiresReact { found: false };
            scan.visit_program(program);
            scan.found
        }

        /// Keeps symbol identities, so local shadowing never inherits an imported hook's identity.
        pub(super) fn from_program(program: &'a Program<'a>) -> Self {
            let mut values = HashMap::new();
            for statement in &program.body {
                let Statement::ImportDeclaration(import) = statement else {
                    continue;
                };
                if import.source.value != "react" || import.import_kind != ImportOrExportKind::Value
                {
                    continue;
                }
                for specifier in import.specifiers.iter().flatten() {
                    let (local, binding) = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                            if specifier.import_kind != ImportOrExportKind::Value {
                                continue;
                            }
                            let name = match &specifier.imported {
                                ModuleExportName::IdentifierName(name) => name.name.as_str(),
                                ModuleExportName::IdentifierReference(name) => name.name.as_str(),
                                ModuleExportName::StringLiteral(name) => name.value.as_str(),
                            };
                            (&specifier.local, Binding::Named(name))
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                            (&specifier.local, Binding::Namespace)
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            (&specifier.local, Binding::Namespace)
                        }
                    };
                    if let Some(symbol) = local.symbol_id.get() {
                        values.insert(symbol, binding);
                    }
                }
            }
            Self { values }
        }

        fn origin(
            &self,
            expression: &Expression<'a>,
            semantic: &Semantic<'a>,
            depth: usize,
        ) -> Option<Binding<'a>> {
            if depth >= 8 {
                return None;
            }
            let next = depth.checked_add(1)?;
            match expression.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    let symbol = identifier
                        .reference_id
                        .get()
                        .and_then(|id| semantic.scoping().get_reference(id).symbol_id())?;
                    if let Some(binding) = self.values.get(&symbol) {
                        return Some(*binding);
                    }
                    if semantic
                        .scoping()
                        .get_resolved_references(symbol)
                        .any(|reference| reference.flags().contains(ReferenceFlags::Write))
                    {
                        return None;
                    }
                    let AstKind::VariableDeclarator(declaration) =
                        semantic.symbol_declaration(symbol).kind()
                    else {
                        return None;
                    };
                    let value = declaration.init.as_ref()?;
                    if declaration.id.get_binding_identifier().is_some() {
                        return self.origin(value, semantic, next);
                    }
                    let BindingPattern::ObjectPattern(pattern) = &declaration.id else {
                        return None;
                    };
                    if !matches!(self.origin(value, semantic, next), Some(Binding::Namespace)) {
                        return None;
                    }
                    let property = pattern.properties.iter().find(|property| {
                        property
                            .value
                            .get_binding_identifier()
                            .and_then(|id| id.symbol_id.get())
                            == Some(symbol)
                    })?;
                    let name = match &property.key {
                        PropertyKey::StaticIdentifier(name) => name.name.as_str(),
                        PropertyKey::StringLiteral(name) => name.value.as_str(),
                        _ => return None,
                    };
                    Some(Binding::Named(name))
                }
                Expression::StaticMemberExpression(member) => matches!(
                    self.origin(&member.object, semantic, next),
                    Some(Binding::Namespace)
                )
                .then_some(Binding::Named(member.property.name.as_str())),
                Expression::ComputedMemberExpression(member) => {
                    let Expression::StringLiteral(name) = member.expression.get_inner_expression()
                    else {
                        return None;
                    };
                    matches!(
                        self.origin(&member.object, semantic, next),
                        Some(Binding::Namespace)
                    )
                    .then_some(Binding::Named(name.value.as_str()))
                }
                Expression::CallExpression(call) if requires_react(call, Some(semantic)) => {
                    Some(Binding::Namespace)
                }
                _ => None,
            }
        }

        /// Resolves named imports, namespace calls and unmodified same-file forwarding aliases.
        pub(super) fn call_name(
            &self,
            expression: &Expression<'a>,
            semantic: &Semantic<'a>,
        ) -> Option<&'a str> {
            match self.origin(expression, semantic, 0) {
                Some(Binding::Named(name)) => Some(name),
                _ => None,
            }
        }
    }
}

/// The optional rule's public diagnostic id.
pub const RULE: &str = "carburetor/no-react-hooks-in-components";

/// React component names begin with an uppercase ASCII letter.
fn component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

/// Whether a returned expression produces JSX without inspecting nested functions.
fn jsx_result(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(value) => {
            jsx_result(&value.consequent) || jsx_result(&value.alternate)
        }
        Expression::LogicalExpression(value) => jsx_result(&value.left) || jsx_result(&value.right),
        Expression::SequenceExpression(value) => value.expressions.last().is_some_and(jsx_result),
        _ => false,
    }
}

struct ReturnsJsx {
    found: bool,
}

impl<'a> Visit<'a> for ReturnsJsx {
    fn visit_function(&mut self, _: &oxc_ast::ast::Function<'a>, _: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _: &oxc_ast::ast::ArrowFunctionExpression<'a>) {}

    fn visit_class(&mut self, _: &oxc_ast::ast::Class<'a>) {}

    fn visit_return_statement(&mut self, value: &ReturnStatement<'a>) {
        self.found |= value.argument.as_ref().is_some_and(jsx_result);
    }
}

/// Checks only this function's own returns, including returns nested in control flow.
fn returns_jsx(body: &FunctionBody<'_>) -> bool {
    let mut scan = ReturnsJsx { found: false };
    scan.visit_function_body(body);
    scan.found
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    bases: &'s Bases,
    bindings: ReactBindings<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Check<'a, '_> {
    fn component_class(&self, class: &oxc_ast::ast::Class<'a>) -> bool {
        is_component_class(class, self.semantic, self.bases)
            || class
                .heritage
                .as_ref()
                .and_then(|heritage| self.bindings.call_name(&heritage.expression, self.semantic))
                .is_some_and(|name| matches!(name, "Component" | "PureComponent"))
    }

    /// Anonymous callbacks of React memo/forwardRef and default exports are components too.
    fn component_binding(&self, id: NodeId) -> bool {
        for parent in self.semantic.nodes().ancestor_kinds(id) {
            match parent {
                AstKind::VariableDeclarator(declaration) => {
                    return declaration
                        .id
                        .get_binding_identifier()
                        .is_some_and(|name| component_name(name.name.as_str()));
                }
                AstKind::ExportDefaultDeclaration(_) => return true,
                AstKind::CallExpression(call) => {
                    return self
                        .bindings
                        .call_name(&call.callee, self.semantic)
                        .is_some_and(|name| matches!(name, "memo" | "forwardRef"));
                }
                AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_) => {
                    return self.semantic.nodes().ancestor_kinds(id).any(
                        |kind| matches!(kind, AstKind::Class(class) if self.component_class(class)),
                    );
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Class(_) => {
                    return false;
                }
                _ => {}
            }
        }
        false
    }

    /// Finds a component owner rather than treating every use-prefixed utility as a component.
    fn in_component(&self, call: &CallExpression<'a>) -> bool {
        for parent in self.semantic.nodes().ancestor_kinds(call.node_id.get()) {
            match parent {
                AstKind::Function(function) => {
                    // A named default export is a component only by its name.
                    let named_default = function.id.is_some()
                        && matches!(
                            self.semantic
                                .nodes()
                                .ancestor_kinds(function.node_id.get())
                                .next(),
                            Some(AstKind::ExportDefaultDeclaration(_))
                        );
                    if function
                        .id
                        .as_ref()
                        .is_some_and(|id| component_name(id.name.as_str()))
                        || (!named_default && self.component_binding(function.node_id.get()))
                        || function.body.as_ref().is_some_and(|body| returns_jsx(body))
                    {
                        return true;
                    }
                }
                AstKind::ArrowFunctionExpression(function) => {
                    let jsx = match &function.body {
                        oxc_ast::ast::ArrowFunctionBody::FunctionBody(body) => returns_jsx(body),
                        body => body.as_expression().is_some_and(jsx_result),
                    };
                    if jsx || self.component_binding(function.node_id.get()) {
                        return true;
                    }
                }
                AstKind::Class(class) => return self.component_class(class),
                _ => {}
            }
        }
        false
    }
}

impl<'a> Visit<'a> for Check<'a, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(name) = self.bindings.call_name(&call.callee, self.semantic) {
            if is_hook_name(name) && self.in_component(call) {
                self.diagnostics.push(report(self.source, call.span.start, RULE, format!(
                    "React {name}() is forbidden in hook-free components. Use AntiHookComponent's \
                     instance-owned state, reads and effects, or leave this optional preset disabled. \
                     Hook-free code reduces render-time ownership work; it does not guarantee zero GC."
                )));
            }
        }
        walk::walk_call_expression(self, call);
    }
}

/// Runs only when explicitly enabled; files without React value imports need no semantic pass.
pub fn check(program: &Program<'_>, source: &Source<'_>, bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic, bases)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source<'_>,
    semantic: &Semantic<'a>,
    bases: &Bases,
) -> Vec<Diagnostic> {
    if !ReactBindings::has_react_source(program) {
        return Vec::new();
    }
    let bindings = ReactBindings::from_program(program);
    let mut check = Check {
        source,
        semantic,
        bases,
        bindings,
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
    fn named_react_aliases_are_reported_only_in_components() {
        let source = "import {useState as state, useMemo as memo} from 'react';\n\
        function utility() { return state(0); }\n\
        function Widget() {\n\
            const [value] = state(0);\n\
            return <p>{memo(() => value, [value])}</p>;\n\
        }";
        assert_eq!(lines(&diagnose(source, check)), [4, 5]);
    }

    #[test]
    fn namespaces_aliases_and_literal_members_keep_react_provenance() {
        let source = "import * as R from 'react';\n\
        const Alias = R;\n\
        const ref = Alias.useRef;\n\
        const Widget = () => {\n\
            ref(null);\n\
            Alias['useEffect'](() => {}, []);\n\
            return <p/>;\n\
        };";
        assert_eq!(lines(&diagnose(source, check)), [5, 6]);
    }

    #[test]
    fn local_shadowing_and_unrelated_use_named_functions_are_not_react() {
        let source = "import React, {useState} from 'react';\n\
        import {useEffect} from 'other-library';\n\
        function Widget(useState: (v: number) => number) {\n\
            useState(0); useEffect();\n\
            function Child(React: {useRef: () => void}) { React.useRef(); return <p/>; }\n\
            return <Child/>;\n\
        }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn memo_forward_ref_and_anonymous_default_components_are_checked() {
        let source = "import {memo as wrap, forwardRef as forward, useId as id} from 'react';\n\
        const first = wrap(() => { id(); return null; });\n\
        const second = forward(function(props, ref) { id(); return null; });\n\
        export default () => { id(); return null; };";
        assert_eq!(lines(&diagnose(source, check)), [2, 3, 4]);
    }

    #[test]
    fn named_default_export_hooks_are_not_components() {
        let source = "import {useId as id} from 'react';
        export default function useCounter() { id(); return null; }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
        let source = "import {useId as id} from 'react';
        export default function Counter() { id(); return null; }";
        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn jsx_returning_functions_and_react_use_are_checked() {
        let source = "import React from 'react';\n\
        const render = () => { React.use(resource); return <p/>; };\n\
        function widget() { React.useTransition(); if (visible) return <p/>; return null; }";
        assert_eq!(lines(&diagnose(source, check)), [2, 3]);
    }

    #[test]
    fn class_component_react_hooks_do_not_confuse_instance_read_apis() {
        let source = "import React from 'react';\n\
        class Widget extends AntiHookComponent {\n\
            render() { React.useState(0); this.useCarburetor(store); return <p/>; }\n\
            helper() { this.useState(); }\n\
        }";
        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn mutable_reassignment_type_imports_and_dynamic_members_are_not_guessed() {
        let source = "import React, {useState} from 'react';\n\
        import type {useRef} from 'react';\n\
        let state = useState; state = unrelated;\n\
        function Widget() { state(0); useRef(); React[method](); return <p/>; }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn escaped_react_module_and_hook_names_preserve_import_identity() {
        let source = r"import {use\u0053tate as state} from '\u0072eact';
        function Widget() { state(0); return <p/>; }";
        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn aliased_hook_diagnostics_point_to_the_exact_callee() {
        let source = r"import {useSyncExternalStore as read} from 'react';
function Widget() {
    read(subscribe, snapshot);
    return <p/>;
}";
        let rows = diagnose(source, check);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].rule, RULE);
        assert_eq!((rows[0].line, rows[0].column), (3, 5));
    }

    #[test]
    fn commonjs_namespaces_and_destructured_react_bindings_are_checked() {
        let source = r"const React = require('react');
const {useState: state, useMemo: memo} = React;
function Widget() {
    state(0);
    memo(() => 1, []);
    React.useRef(null);
    return <p/>;
}";
        assert_eq!(lines(&diagnose(source, check)), [4, 5, 6]);
    }

    #[test]
    fn a_locally_shadowed_require_is_not_assumed_to_load_react() {
        let source = r"function require(name) { return custom; }
const React = require('react');
function Widget() { React.useState(0); return <p/>; }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn aliased_react_component_classes_preserve_component_ownership() {
        let source = r"import {Component as Base, useState} from 'react';
class Widget extends Base {
    render() { useState(0); return null; }
}";
        assert_eq!(lines(&diagnose(source, check)), [3]);
    }
}
