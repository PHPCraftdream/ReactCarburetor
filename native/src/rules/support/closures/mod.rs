//! The analysis the two allocation rules share: which functions inside a class member are candidates
//! for extraction, what each one captures, and whether it depends on the class it sits in.
//!
//! A closure that reads a class field or calls a method cannot leave the class; one that only reads
//! its own parameters and locals can. Both rules need those three answers before they can report
//! anything, so they get them from here instead of each walking the member again.

// temporary — wired into a real rule by LA-2/LA-3, remove this allow once at least one of them lands
#![allow(dead_code)]

use std::collections::*;

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::*;
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::support::bases::*;
use crate::rules::support::chain::{chain_root, Base};
use crate::rules::support::names::{extends_any, member_call_name};

mod collect;
mod dependency;
mod scan;
#[cfg(test)]
mod tests;

use collect::Collect;
use dependency::{class_type_parameters, member_class_dependency};
use scan::{Declarator, Scan, SiteFlags};

/// The one semantic pass per file both allocation rules share.
pub fn build_semantic<'a>(program: &'a Program<'a>) -> Semantic<'a> {
    SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic
}

/// How deep the same-file heritage walk follows a base class.
///
/// A real chain is a handful deep; the ceiling is there for the pathological cycle, which would
/// otherwise walk until the stack went.
const MAX_HERITAGE_DEPTH: usize = 8;

/// Whether a class is a component, by its own `extends` clause or a base of one in the same file.
///
/// The direct check is the one every rule shares. The walk is for a project-local subclass of a
/// component, whose members are as much render code as the base's own. An imported base stops it,
/// which is the documented limitation every rule in this crate shares rather than a gap here.
pub fn is_component_class(class: &Class<'_>, semantic: &Semantic<'_>) -> bool {
    extends_any(class, &COMPONENT_BASES) || extends_component_class(class, semantic, 0)
}

/// Whether the class's heritage names a same-file class that is itself a component.
fn extends_component_class(class: &Class<'_>, semantic: &Semantic<'_>, depth: usize) -> bool {
    if depth >= MAX_HERITAGE_DEPTH {
        return false;
    }

    // Only a bare name can name a class this file declares; anything else was already answered by
    // the direct check.
    let Some(heritage) = &class.heritage else {
        return false;
    };
    let Expression::Identifier(base) = &heritage.expression else {
        return false;
    };
    let symbol = base
        .reference_id
        .get()
        .and_then(|reference| semantic.scoping().get_reference(reference).symbol_id());
    let Some(symbol) = symbol else { return false };
    let AstKind::Class(base_class) = semantic.symbol_declaration(symbol).kind() else {
        return false;
    };

    // `class A extends A {}` would otherwise recurse into itself forever.
    if base_class.node_id() == class.node_id() {
        return false;
    }

    extends_any(base_class, &COMPONENT_BASES)
        || extends_component_class(base_class, semantic, depth + 1)
}

/// What one class member's closures add up to.
pub struct MemberAnalysis<'a> {
    /// The closures worth extracting, after every exclusion, in source order.
    pub closures: Vec<Candidate<'a>>,
    /// Whether the member itself needs the class it was written in.
    pub class_dependency: bool,
}

/// One closure an allocation rule could report, and everything its message needs to say.
pub struct Candidate<'a> {
    /// The closure's own range, which is where the rule reports.
    pub span: Span,
    /// What the closure reads out of the member it was written in, in first-use order.
    pub captures: Vec<Capture<'a>>,
    /// Whether lifting the closure out of the class would change what `this` means inside it.
    pub class_dependency: bool,
    /// How the member holds on to the closure, which decides which of the two rules reports it.
    pub usage: Usage<'a>,
    /// The method the closure forwards to, when it forwards to exactly one.
    pub forwarder: Option<Forwarder<'a>>,
    /// Whether the closure runs while a component renders.
    pub executes_in_render: bool,
}

/// A binding a closure reads out of the member it was written in.
pub struct Capture<'a> {
    /// The name the binding was declared under.
    pub name: &'a str,
    /// Whether it was destructured off `this`, which ties the closure to the class however the
    /// closure itself is written.
    pub this_derived: bool,
    /// Whether the closure itself assigns to it.
    pub written_by_closure: bool,
    /// Whether anything in the member assigns to it after its declarator.
    pub written_after_init: bool,
}

/// How a closure arrives in the member, which is what separates the two rules' territories.
pub enum Usage<'a> {
    /// `const onClick = () => ...`: a closure bound to a name that is only ever called, which is
    /// what a method would be.
    DirectHelper(&'a str),
    /// Anything else: handed to something, returned, or stored where the name is not readable.
    Callback,
}

/// A closure that is nothing but forwarding to a method: `() => this.m(a, b)`.
pub struct Forwarder<'a> {
    /// The method forwarded to — `m` in `() => this.m(a, b)`.
    pub method: &'a str,
}

/// The candidates inside a class method.
pub fn analyze_method<'a>(
    method: &'a MethodDefinition<'a>,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    analyze(
        Root::Function(&method.value),
        method.span,
        method.node_id(),
        semantic,
        member_is_render,
    )
}

/// The candidates inside a class field.
pub fn analyze_field<'a>(
    field: &'a PropertyDefinition<'a>,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    // A closure inside a non-function class-field initializer is built once per instance, so it
    // costs nothing per render and there is nothing to extract. The field's own function value is
    // the member's own body, so it is the root rather than a candidate.
    let Some(value) = &field.value else {
        return MemberAnalysis {
            closures: Vec::new(),
            class_dependency: false,
        };
    };

    let root = match value {
        Expression::FunctionExpression(function) => Root::Function(function),
        Expression::ArrowFunctionExpression(arrow) => Root::Arrow(arrow),
        _ => {
            return MemberAnalysis {
                closures: Vec::new(),
                class_dependency: false,
            }
        }
    };

    analyze(
        root,
        field.span,
        field.node_id(),
        semantic,
        member_is_render,
    )
}

enum Root<'a> {
    Function(&'a Function<'a>),
    Arrow(&'a ArrowFunctionExpression<'a>),
}

impl<'a> Root<'a> {
    fn id(&self) -> NodeId {
        match self {
            Self::Function(function) => function.node_id(),
            Self::Arrow(arrow) => arrow.node_id(),
        }
    }

    fn visit<V: Visit<'a>>(&self, visitor: &mut V) {
        match self {
            Self::Function(function) => visitor.visit_function(function, ScopeFlags::Function),
            Self::Arrow(arrow) => visitor.visit_arrow_function_expression(arrow),
        }
    }
}

/// Scans one member and builds a candidate out of every function site the scan leaves standing.
fn analyze<'a>(
    root: Root<'a>,
    member_span: Span,
    member_id: NodeId,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    let mut scan = Scan {
        root_id: root.id(),
        frames: Vec::new(),
        sites: HashMap::new(),
        iifes: HashSet::new(),
        this_assigned: HashSet::new(),
        jsx_props: HashSet::new(),
        protected_callbacks: HashSet::new(),
        synchronous: HashSet::new(),
        declarators: Vec::new(),
        kinds: Vec::new(),
        jsx_component: false,
        render_executes: member_is_render,
    };

    root.visit(&mut scan);

    MemberAnalysis {
        closures: Collect {
            root_id: root.id(),
            sites: &scan.sites,
            declarators: &scan.declarators,
            member_span,
            type_parameters: class_type_parameters(semantic, member_id),
            member_is_render,
            semantic,
            closures: Vec::new(),
        }
        .collect(&root),
        class_dependency: member_class_dependency(&root, member_id, semantic),
    }
}

/// Whether a span lies inside another, which is the only identity a node has here.
fn contains(outer: Span, inner: Span) -> bool {
    inner.start >= outer.start && inner.end <= outer.end
}

/// The name a call was made under, whether `transaction(...)` or `this.update(...)`.
fn callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => member_call_name(callee),
    }
}

/// Peels through the parentheses every real IIFE callee is wrapped in: `(() => {})()`.
fn unwrap_parens<'e, 'a>(expression: &'e Expression<'a>) -> &'e Expression<'a> {
    match expression {
        Expression::ParenthesizedExpression(inner) => unwrap_parens(&inner.expression),
        _ => expression,
    }
}

/// Whether an expression is itself a function, as the callee of an IIFE is.
fn is_function_site(expression: &Expression<'_>) -> bool {
    matches!(
        unwrap_parens(expression),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// The function a JSX attribute hands its element, when it hands one.
fn expression_function(expression: &Expression<'_>) -> Option<Span> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => Some(arrow.span),
        Expression::FunctionExpression(function) => Some(function.span),
        Expression::ParenthesizedExpression(expression) => {
            expression_function(&expression.expression)
        }
        Expression::TSAsExpression(expression) => expression_function(&expression.expression),
        Expression::TSSatisfiesExpression(expression) => {
            expression_function(&expression.expression)
        }
        Expression::TSTypeAssertion(expression) => expression_function(&expression.expression),
        Expression::TSNonNullExpression(expression) => expression_function(&expression.expression),
        Expression::TSInstantiationExpression(expression) => {
            expression_function(&expression.expression)
        }
        _ => None,
    }
}

fn jsx_expression_function(expression: &JSXExpression<'_>) -> Option<Span> {
    match expression {
        JSXExpression::ArrowFunctionExpression(arrow) => Some(arrow.span),
        JSXExpression::FunctionExpression(function) => Some(function.span),
        JSXExpression::ParenthesizedExpression(expression) => {
            expression_function(&expression.expression)
        }
        JSXExpression::TSAsExpression(expression) => expression_function(&expression.expression),
        JSXExpression::TSSatisfiesExpression(expression) => {
            expression_function(&expression.expression)
        }
        JSXExpression::TSTypeAssertion(expression) => expression_function(&expression.expression),
        JSXExpression::TSNonNullExpression(expression) => {
            expression_function(&expression.expression)
        }
        JSXExpression::TSInstantiationExpression(expression) => {
            expression_function(&expression.expression)
        }
        _ => None,
    }
}

fn attribute_function(value: &JSXAttributeValue<'_>) -> Option<Span> {
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return None;
    };

    jsx_expression_function(&container.expression)
}

/// Whether an assignment writes a member in all but syntax: `this.f = fn` or `this.#f = fn`.
fn is_this_target(target: &AssignmentTarget<'_>) -> bool {
    match target {
        AssignmentTarget::StaticMemberExpression(member) => {
            matches!(member.object, Expression::ThisExpression(_))
        }
        AssignmentTarget::PrivateFieldExpression(member) => {
            matches!(member.object, Expression::ThisExpression(_))
        }
        _ => false,
    }
}
