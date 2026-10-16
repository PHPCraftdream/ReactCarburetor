use std::collections::HashMap;

use oxc_ast::ast::{ArrowFunctionExpression, Function, IdentifierReference, ThisExpression};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{ReferenceFlags, Semantic};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use super::dependency::CaptureCollector;
use super::contains;

/// Indexes closure candidates once so each query only walks the requested subtree.
pub struct CaptureIndex<'a> {
    nodes: HashMap<Span, AstKind<'a>>,
}

impl<'a> CaptureIndex<'a> {
    pub fn new(semantic: &Semantic<'a>) -> Self {
        let nodes = semantic
            .nodes()
            .iter()
            .filter_map(|node| {
                let kind = node.kind();
                matches!(
                    kind,
                    AstKind::ArrowFunctionExpression(_)
                        | AstKind::Function(_)
                        | AstKind::CallExpression(_)
                )
                .then(|| (node.span(), kind))
            })
            .collect::<HashMap<_, _>>();
        Self { nodes }
    }

    /// Returns whether the indexed expression reads a non-module binding or lexical dynamic value.
    pub fn captures_non_module(&self, span: Span, semantic: &Semantic<'_>) -> bool {
        let Some(kind) = self.nodes.get(&span) else {
            return false;
        };
        let mut probe = CaptureProbe {
            scoping: semantic.scoping(),
            found: false,
            arrows: Vec::new(),
            site: span,
        };
        match kind {
            AstKind::ArrowFunctionExpression(arrow) => probe.visit_arrow_function_expression(arrow),
            AstKind::Function(function) => probe.visit_function(function, ScopeFlags::Function),
            AstKind::CallExpression(call) => probe.probe_call(call),
            _ => return false,
        }
        probe.found
    }
}

struct CaptureProbe<'s> {
    scoping: &'s oxc_semantic::Scoping,
    found: bool,
    arrows: Vec<bool>,
    site: Span,
}

impl CaptureProbe<'_> {
    fn runtime_reference(&self, identifier: &IdentifierReference<'_>) -> Option<oxc_semantic::SymbolId> {
        let reference = identifier
            .reference_id
            .get()
            .map(|id| self.scoping.get_reference(id))?;
        reference
            .flags()
            .intersects(ReferenceFlags::Read | ReferenceFlags::Write)
            .then(|| reference.symbol_id())
            .flatten()
    }

    fn lexical_arguments(&self) -> bool {
        self.arrows.first() == Some(&true)
            && self.arrows.iter().all(|is_arrow| *is_arrow)
    }

    fn external_symbol(&self, symbol: oxc_semantic::SymbolId) -> bool {
        self.scoping.symbol_scope_id(symbol) != self.scoping.root_scope_id()
            && !contains(self.site, self.scoping.symbol_span(symbol))
    }

    /// `bind` call: receiver/argument closures are lexical, so their `this` stays dynamic-bound.
    fn probe_call(&mut self, call: &oxc_ast::ast::CallExpression) {
        self.arrows.push(true);
        walk::walk_call_expression(self, call);
        self.arrows.pop();
    }
}

impl<'a> Visit<'a> for CaptureProbe<'_> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        self.arrows.push(false);
        walk::walk_function(self, function, flags);
        self.arrows.pop();
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.arrows.push(true);
        walk::walk_arrow_function_expression(self, arrow);
        self.arrows.pop();
    }

    fn visit_this_expression(&mut self, _: &ThisExpression) {
        if self.arrows.first() == Some(&true)
            && self.arrows.iter().all(|is_arrow| *is_arrow)
        {
            self.found = true;
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.found {
            return;
        }
        let symbol = self.runtime_reference(identifier);
        if identifier.name == "arguments" && self.lexical_arguments() {
            let explicit_binding = self.runtime_reference(identifier).is_some();
            if !explicit_binding {
                self.found = true;
                return;
            }
        }
        if symbol.is_some_and(|symbol| self.external_symbol(symbol)) {
            self.found = true;
        }
    }
}

/// Existing H34 component-only capture semantics; intentionally unchanged.
pub fn captures_in_span(span: Span, semantic: &Semantic<'_>, enclosing: Span) -> bool {
    for node in semantic.nodes() {
        if node.span() != span {
            continue;
        }
        let mut probe = LegacyCaptureProbe {
            semantic,
            enclosing,
            site: span,
            found: false,
            arrows: vec![true],
        };
        match node.kind() {
            AstKind::ArrowFunctionExpression(arrow) => probe.visit_arrow_function_expression(arrow),
            AstKind::Function(function) => probe.visit_function(function, ScopeFlags::Function),
            _ => return false,
        }
        return probe.found;
    }
    false
}

struct LegacyCaptureProbe<'a> {
    semantic: &'a Semantic<'a>,
    enclosing: Span,
    site: Span,
    found: bool,
    arrows: Vec<bool>,
}

impl<'a> Visit<'a> for LegacyCaptureProbe<'a> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        self.arrows.push(false);
        walk::walk_function(self, function, flags);
        self.arrows.pop();
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.arrows.push(true);
        walk::walk_arrow_function_expression(self, arrow);
        self.arrows.pop();
    }

    fn visit_this_expression(&mut self, _: &ThisExpression) {
        for index in (0..self.arrows.len()).rev() {
            if !self.arrows[index] {
                break;
            }
            self.found = true;
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if let Some(symbol) = identifier.reference_id.get().and_then(|reference| {
            let reference = self.semantic.scoping().get_reference(reference);
            if reference.flags().intersects(ReferenceFlags::Read | ReferenceFlags::Write) {
                reference.symbol_id()
            } else {
                None
            }
        }) {
            let declaration = self.semantic.scoping().symbol_span(symbol);
            if contains(self.enclosing, declaration) && !contains(self.site, declaration) {
                self.found = true;
            }
        }
    }
}

pub fn captures_outside<'a>(function: &impl FnCaptureSite<'a>, semantic: &Semantic<'a>, enclosing: Span) -> bool {
    let mut collector = CaptureCollector {
        scoping: semantic.scoping(),
        symbols: Vec::new(),
        names: Vec::new(),
        written: Vec::new(),
    };
    function.collect(&mut collector);
    let function_span = function.span();
    collector.symbols.iter().any(|symbol| {
        let declaration = semantic.scoping().symbol_span(*symbol);
        contains(enclosing, declaration) && !contains(function_span, declaration)
    })
}

pub trait FnCaptureSite<'a> {
    fn collect<V: Visit<'a>>(&self, visitor: &mut V);
    fn span(&self) -> Span;
}

impl<'a> FnCaptureSite<'a> for ArrowFunctionExpression<'a> {
    fn collect<V: Visit<'a>>(&self, visitor: &mut V) {
        visitor.visit_arrow_function_expression(self);
    }
    fn span(&self) -> Span {
        self.span
    }
}

impl<'a> FnCaptureSite<'a> for Function<'a> {
    fn collect<V: Visit<'a>>(&self, visitor: &mut V) {
        visitor.visit_function(self, ScopeFlags::Function);
    }
    fn span(&self) -> Span {
        self.span
    }
}
