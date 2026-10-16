//! H33: avoid manually memoizing values already observed through store hooks.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{Argument, BindingPattern, CallExpression, Expression, Program, VariableDeclarator};
use oxc_ast_visit::Visit;
use oxc_semantic::{ReferenceFlags, Semantic, SymbolId};

use crate::rules::report;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The diagnostic id registered by the rule table.
pub const RULE: &str = "carburetor/no-memo-over-store-read";

const MESSAGE: &str = "This memo reads a value already observed by a store hook. Derive it in the selector, or define a Computed and read it with useComputedValue.";

fn is_call(expression: &Expression<'_>, names: &[&str]) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else { return false; };
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => names.contains(&identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => matches!(&member.object, Expression::Identifier(id) if id.name == "React") && names.contains(&member.property.name.as_str()),
        _ => false,
    }
}

fn pattern_symbols(pattern: &BindingPattern<'_>, output: &mut HashSet<SymbolId>) {
    match pattern {
        BindingPattern::BindingIdentifier(id) => { if let Some(symbol) = id.symbol_id.get() { output.insert(symbol); } }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties { pattern_symbols(&property.value, output); }
            if let Some(rest) = &object.rest { pattern_symbols(&rest.argument, output); }
        }
        BindingPattern::ArrayPattern(array) => {
            for item in array.elements.iter().flatten() { pattern_symbols(item, output); }
            if let Some(rest) = &array.rest { pattern_symbols(&rest.argument, output); }
        }
        BindingPattern::AssignmentPattern(assignment) => pattern_symbols(&assignment.left, output),
    }
}

#[derive(Default)]
struct Bindings(HashMap<oxc_span::Span, HashSet<SymbolId>>);

struct References<'s> {
    scoping: &'s oxc_semantic::Scoping,
    reads: HashSet<SymbolId>,
}
impl<'a> Visit<'a> for References<'_> {
    fn visit_identifier_reference(&mut self, identifier: &oxc_ast::ast::IdentifierReference<'a>) {
        let Some(id) = identifier.reference_id.get() else { return };
        let reference = self.scoping.get_reference(id);
        // Type-only references (e.g. `typeof value` in a return type) are not reads.
        if !reference.flags().intersects(ReferenceFlags::Read | ReferenceFlags::Write) { return; }
        if let Some(symbol) = reference.symbol_id() { self.reads.insert(symbol); }
    }
}

struct Pending {
    span: oxc_span::Span,
    scope: oxc_span::Span,
    reads: HashSet<SymbolId>,
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    bindings: Bindings,
    pending: Vec<Pending>,
    diagnostics: Vec<Diagnostic>,
}
impl<'a> Rule<'a> for Check<'a, '_> {
    fn finish(self) -> Vec<Diagnostic> {
        let Check { source, bindings, pending, mut diagnostics, .. } = self;
        for item in pending {
            let Some(scope_bindings) = bindings.0.get(&item.scope) else { continue; };
            if item.reads.iter().any(|symbol| scope_bindings.contains(symbol)) {
                diagnostics.push(report(source, item.span.start, RULE, MESSAGE.to_string()));
            }
        }
        diagnostics
    }

    fn declarator(&mut self, declarator: &VariableDeclarator<'a>, context: &Context) {
        let is_store_hook = declarator
            .init
            .as_ref()
            .is_some_and(|init| {
                is_call(
                    init,
                    &[
                        "useCarburetorValue",
                        "useComputedValue",
                        "useResourceValue",
                    ],
                )
            });
        if context.in_render
            && context.render_kind == Some(crate::rules::support::walk::RenderKind::Function)
            && is_store_hook
        {
            pattern_symbols(
                &declarator.id,
                self.bindings
                    .0
                    .entry(context.render_scope.unwrap_or(context.function))
                    .or_default(),
            );
        }
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        if !context.in_render || context.render_kind != Some(crate::rules::support::walk::RenderKind::Function) { return; }
        let hook = match call.callee.get_inner_expression() {
            Expression::Identifier(id) => matches!(id.name.as_str(), "useMemo" | "useCallback"),
            Expression::StaticMemberExpression(member) => matches!(&member.object, Expression::Identifier(id) if id.name == "React") && matches!(member.property.name.as_str(), "useMemo" | "useCallback"),
            _ => false,
        };
        if !hook { return; }
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else { return; };
        let scope = context.render_scope.unwrap_or(context.function);
        let mut references = References { scoping: self.semantic.scoping(), reads: HashSet::new() };
        match argument.get_inner_expression() {
            Expression::ArrowFunctionExpression(arrow) => references.visit_arrow_function_expression(arrow),
            Expression::FunctionExpression(function) => references.visit_function(function, oxc_syntax::scope::ScopeFlags::Function),
            Expression::Identifier(identifier) => {
        if let Some(symbol) = identifier.reference_id.get().and_then(|id| self.semantic.scoping().get_reference(id).symbol_id()) {
                    match self.semantic.symbol_declaration(symbol).kind() {
                        oxc_ast::AstKind::VariableDeclarator(declaration) => {
                            if let Some(init) = &declaration.init {
                                match init.get_inner_expression() {
                                    Expression::ArrowFunctionExpression(arrow) => references.visit_arrow_function_expression(arrow),
                                    Expression::FunctionExpression(function) => references.visit_function(function, oxc_syntax::scope::ScopeFlags::Function),
                                    _ => {}
                                }
                            }
                        }
                        oxc_ast::AstKind::Function(function) => {
                            references.visit_function(function, oxc_syntax::scope::ScopeFlags::Function);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        self.pending.push(Pending { span: call.span, scope, reads: references.reads });
    }
}

/// Reports memo callbacks that read a store-hook binding from the same function component.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a, 's>(
    program: &Program<'a>,
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
) -> Vec<Diagnostic> {
    walk_rule(
        program,
        Check { source, semantic, bindings: Bindings::default(), pending: Vec::new(), diagnostics: Vec::new() },
    )
}

#[cfg(test)]
mod tests;
