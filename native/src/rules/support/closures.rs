//! The analysis the two allocation rules share: which functions inside a class member are candidates
//! for extraction, what each one captures, and whether it depends on the class it sits in.
//!
//! A closure that reads a class field or calls a method cannot leave the class; one that only reads
//! its own parameters and locals can. Both rules need those three answers before they can report
//! anything, so they get them from here instead of each walking the member again.

// temporary — wired into a real rule by LA-2/LA-3, remove this allow once at least one of them lands
#![allow(dead_code)]

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, AssignmentExpression, AssignmentTarget, BindingPattern,
    CallExpression, Class, Expression, Function, FunctionType, IdentifierReference, JSXAttribute,
    JSXAttributeValue, JSXElementName, JSXExpression, JSXOpeningElement, MethodDefinition, NewTarget,
    PrivateFieldExpression, PrivateInExpression, Program, PropertyDefinition, Statement, Super,
    TSTypeName, TSThisType, TSTypeReference, ThisExpression, VariableDeclaration,
    VariableDeclarationKind, VariableDeclarator,
};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, ReferenceFlags, Scoping, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::support::bases::{
    COMPONENT_BASES, EXCLUDED_CALLBACK_APIS, RENDER_TRACKED_APIS, SYNCHRONOUS_CALLBACKS,
};
use crate::rules::support::chain::{chain_root, Base};
use crate::rules::support::names::{extends_any, member_call_name};

/// The one semantic pass per file both allocation rules share.
pub fn build_semantic<'a>(program: &'a Program<'a>) -> Semantic<'a> {
    SemanticBuilder::new().with_build_nodes(true).build(program).semantic
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
    let Some(heritage) = &class.heritage else { return false };
    let Expression::Identifier(base) = &heritage.expression else { return false };
    let symbol = base
        .reference_id
        .get()
        .and_then(|reference| semantic.scoping().get_reference(reference).symbol_id());
    let Some(symbol) = symbol else { return false };
    let AstKind::Class(base_class) = semantic.symbol_declaration(symbol).kind() else { return false };

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
    analyze(&method.value, method.span, method.node_id(), semantic, member_is_render)
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
    let Some(Expression::FunctionExpression(root)) = &field.value else {
        // An arrow field is that function value in arrow clothing: its signature and body can
        // still need the class, and the member-level answer is what `require-module-function`
        // reads. Its body stays the root, so no closure is collected here — a closure inside the
        // field's body remains the non-candidate it already was.
        let class_dependency = match &field.value {
            Some(Expression::ArrowFunctionExpression(arrow)) => {
                let mut scan = DependencyScan {
                    type_parameters: class_type_parameters(semantic, field.node_id()),
                    found: false,
                };

                scan.visit_arrow_function_expression(arrow);

                scan.found
            }
            _ => false,
        };

        return MemberAnalysis { closures: Vec::new(), class_dependency };
    };

    analyze(root, field.span, field.node_id(), semantic, member_is_render)
}

/// Scans one member and builds a candidate out of every function site the scan leaves standing.
fn analyze<'a>(
    root: &Function<'a>,
    member_span: Span,
    member_id: NodeId,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    let mut scan = Scan {
        root_id: root.node_id(),
        frames: Vec::new(),
        sites: HashMap::new(),
        iifes: HashSet::new(),
        this_assigned: HashSet::new(),
        jsx_props: HashSet::new(),
        protected_callbacks: HashSet::new(),
        synchronous: HashSet::new(),
        declarators: Vec::new(),
        kinds: Vec::new(),
        jsx_element: None,
        render_executes: member_is_render,
    };

    scan.visit_function(root, ScopeFlags::Function);

    MemberAnalysis {
        closures: Collect {
            root_id: root.node_id(),
            sites: &scan.sites,
            declarators: &scan.declarators,
            member_span,
            member_is_render,
            semantic,
            closures: Vec::new(),
        }
        .collect(root),
        class_dependency: member_class_dependency(root, member_id, semantic),
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
fn attribute_function(value: &JSXAttributeValue<'_>) -> Option<Span> {
    let JSXAttributeValue::ExpressionContainer(container) = value else { return None };

    match &container.expression {
        JSXExpression::ArrowFunctionExpression(arrow) => Some(arrow.span),
        JSXExpression::FunctionExpression(function) => Some(function.span),
        _ => None,
    }
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

/// What the scan decided about one function site.
struct SiteFlags {
    /// The member is render code and this site runs while it renders.
    executes_in_render: bool,
}

/// One level of function nesting during the scan.
struct Frame {
    /// The function's own span.
    span: Span,
    /// Whether it is an arrow, whose `this` is the enclosing function's.
    is_arrow: bool,
    /// The render-execution state to restore when this frame closes.
    enclosing_render: bool,
    /// Whether this frame itself executes while a component renders.
    render: bool,
    /// A `this` below here binds to this frame.
    uses_this: bool,
    /// An `arguments` or `new.target` below here belongs to this frame alone.
    uses_lexical: bool,
    /// This frame calls one of the tracked-data APIs.
    calls_tracked: bool,
}

/// One walk over a class member, recording which function sites are candidates and why.
struct Scan<'a> {
    /// The member's own body, which is never a candidate of its own.
    root_id: NodeId,
    /// The frames of function nesting, innermost last.
    frames: Vec<Frame>,
    /// What the scan decided about each candidate site, keyed by the site's span.
    sites: HashMap<Span, SiteFlags>,
    /// Functions that are the direct callee of a call, which run where they are written.
    iifes: HashSet<Span>,
    /// Functions assigned to `this.<x>` or `this.#x`, which are members in all but syntax.
    this_assigned: HashSet<Span>,
    /// Functions handed to a component element as a prop, which stay the props' problem.
    jsx_props: HashSet<Span>,
    /// Functions given to a call that inspects its callback body in place.
    protected_callbacks: HashSet<Span>,
    /// Function arguments of a synchronous-callback receiver, which run while they evaluate.
    synchronous: HashSet<Span>,
    /// The declarators in the member, for telling a helper call from a callback argument.
    declarators: Vec<Declarator<'a>>,
    /// The kinds of the variable declarations whose declarators are being walked, innermost last.
    kinds: Vec<VariableDeclarationKind>,
    /// The tag name of the JSX element an attribute belongs to, when it is a plain name.
    jsx_element: Option<&'a str>,
    /// Whether the node being walked executes while a component renders.
    render_executes: bool,
}

/// A declarator in the member, and the binding it introduces.
struct Declarator<'a> {
    kind: VariableDeclarationKind,
    symbol: SymbolId,
    name: &'a str,
    init: Option<Span>,
}

impl Scan<'_> {
    /// Whether another rule needs this body where it sits.
    fn protected(&self, span: Span) -> bool {
        self.iifes.contains(&span)
            || self.this_assigned.contains(&span)
            || self.jsx_props.contains(&span)
            || self.protected_callbacks.contains(&span)
    }

    /// Enters a function boundary, remembering what to restore on the way out.
    ///
    /// `site` says whether this boundary is a candidate of its own. The member's own body is
    /// walked as the root, so it is never reported against itself.
    fn enter_function(&mut self, id: NodeId, span: Span, is_arrow: bool) -> bool {
        let is_root = id == self.root_id;
        let enclosing_render = self.render_executes;
        // Render code stops at a function boundary, unless the function runs in place as a
        // synchronous callback of one that evaluates during the render.
        if !is_root && !self.synchronous.contains(&span) {
            self.render_executes = false;
        }

        let site = !is_root && !self.protected(span);

        self.frames.push(Frame {
            span,
            is_arrow,
            enclosing_render,
            render: self.render_executes,
            uses_this: false,
            uses_lexical: false,
            calls_tracked: false,
        });

        if site {
            self.sites.insert(
                span,
                SiteFlags { executes_in_render: self.render_executes },
            );
        }

        site
    }

    /// Leaves a function boundary, carrying what the frame learned into the site's decision.
    fn leave_function(&mut self, span: Span) {
        let frame = self.frames.pop().expect("a frame was pushed on entry");

        self.render_executes = frame.enclosing_render;

        if !self.sites.contains_key(&span) {
            return;
        }

        // A closure that runs during render and touches tracked data has to stay in render: moving
        // it out would hide the access from the render rules and make the hook rule report a false
        // positive for the access it left behind.
        if frame.calls_tracked && frame.render {
            self.sites.remove(&span);

            return;
        }

        // A function expression binds its own `this`, so lifting one that uses it would change what
        // the body sees; neither `arguments` nor `new.target` survives a move at all.
        if frame.uses_lexical || (frame.uses_this && !frame.is_arrow) {
            self.sites.remove(&span);
        }
    }
}

impl<'a> Visit<'a> for Scan<'a> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let is_site = function.r#type == FunctionType::FunctionExpression
            && !function.generator
            && self.enter_function(function.node_id(), function.span, false);

        walk::walk_function(self, function, flags);

        if is_site {
            self.leave_function(function.span);
        }
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        // A member's own body is always a `Function`, so an arrow is never the root.
        let site = self.enter_function(arrow.node_id(), arrow.span, true);

        walk::walk_arrow_function_expression(self, arrow);

        if site {
            self.leave_function(arrow.span);
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if identifier.name == "arguments" {
            // Each function owns its own `arguments`, so only the innermost frame is affected.
            if let Some(frame) = self.frames.last_mut() {
                frame.uses_lexical = true;
            }
        }

        walk::walk_identifier_reference(self, identifier);
    }

    fn visit_this_expression(&mut self, expression: &ThisExpression) {
        // An arrow's `this` is the enclosing function's, so every frame up to and including the
        // first dynamic one owns this occurrence.
        for frame in self.frames.iter_mut().rev() {
            frame.uses_this = true;

            if !frame.is_arrow {
                break;
            }
        }

        walk::walk_this_expression(self, expression);
    }

    fn visit_new_target(&mut self, expression: &NewTarget) {
        if let Some(frame) = self.frames.last_mut() {
            frame.uses_lexical = true;
        }

        walk::walk_new_target(self, expression);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if callee_name(&call.callee).is_some_and(|name| EXCLUDED_CALLBACK_APIS.contains(&name)) {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    self.protected_callbacks.insert(expression.span());
                }
            }
        }

        // An IIFE runs where it is written, so its body is not an allocation the render pays for.
        // The callee is almost always parenthesized (`(() => {})()`), so the site's own span —
        // what `enter_function` records it under — is the unwrapped expression's, not the callee's.
        if is_function_site(&call.callee) {
            self.iifes.insert(unwrap_parens(&call.callee).span());
        }

        // A closure that runs during render and reads or writes tracked data belongs in render.
        if callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name)) {
            if let Some(frame) = self.frames.last_mut() {
                frame.calls_tracked = true;
            }
        }

        // `ids.map(id => ...)` evaluates while the expression around it does, so its callback
        // inherits whatever the surrounding code is.
        if member_call_name(&call.callee).is_some_and(|name| SYNCHRONOUS_CALLBACKS.contains(&name)) {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    self.synchronous.insert(expression.span());
                }
            }
        }

        walk::walk_call_expression(self, call);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        if is_this_target(&expression.left) && is_function_site(&expression.right) {
            self.this_assigned.insert(expression.right.span());
        }

        walk::walk_assignment_expression(self, expression);
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        let outer = self.jsx_element.take();

        self.jsx_element = match &element.name {
            JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
            JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
            _ => None,
        };

        walk::walk_jsx_opening_element(self, element);

        self.jsx_element = outer;
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        // A lowercase name is a DOM element, whose attribute update costs less than a subtree
        // render; only a component prop is worth protecting from the other direction.
        let component = self
            .jsx_element
            .is_some_and(|element| element.chars().next().is_some_and(|first| first.is_uppercase()));

        if component {
            if let Some(value) = &attribute.value {
                if let Some(span) = attribute_function(value) {
                    self.jsx_props.insert(span);
                }
            }
        }

        walk::walk_jsx_attribute(self, attribute);
    }

    fn visit_variable_declaration(&mut self, declaration: &VariableDeclaration<'a>) {
        self.kinds.push(declaration.kind);

        walk::walk_variable_declaration(self, declaration);

        self.kinds.pop();
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let kind = self.kinds.last().copied().unwrap_or(VariableDeclarationKind::Var);

        if let Some(identifier) = declarator.id.get_binding_identifier() {
            if let Some(symbol) = identifier.symbol_id.get() {
                self.declarators.push(Declarator {
                    kind,
                    symbol,
                    name: identifier.name.as_str(),
                    init: declarator.init.as_ref().map(GetSpan::span),
                });
            }
        }

        walk::walk_variable_declarator(self, declarator);
    }
}

/// The node a candidate was found at, which is what every later pass walks.
enum Site<'n, 'a> {
    /// `() => ...`, whose `this` is the enclosing function's.
    Arrow(&'n ArrowFunctionExpression<'a>),
    /// `function () {}`, which binds a `this` of its own.
    Expression(&'n Function<'a>),
}

impl<'n, 'a> Site<'n, 'a> {
    fn span(&self) -> Span {
        match self {
            Site::Arrow(arrow) => arrow.span,
            Site::Expression(function) => function.span,
        }
    }

    /// Runs a visitor over the site's whole extent, nested functions included.
    fn walk_into<V: Visit<'a>>(&self, visitor: &mut V) {
        match self {
            Site::Arrow(arrow) => visitor.visit_arrow_function_expression(arrow),
            Site::Expression(function) => visitor.visit_function(function, ScopeFlags::Function),
        }
    }
}

/// Builds a candidate out of every function site the scan left standing.
struct Collect<'a, 's> {
    /// The member's own body, which is never a candidate of its own.
    root_id: NodeId,
    sites: &'s HashMap<Span, SiteFlags>,
    declarators: &'s [Declarator<'a>],
    member_span: Span,
    member_is_render: bool,
    semantic: &'s Semantic<'s>,
    closures: Vec<Candidate<'a>>,
}

impl<'a, 's> Collect<'a, 's> {
    /// Walks the member and returns the candidates, in source order.
    fn collect(mut self, root: &Function<'a>) -> Vec<Candidate<'a>> {
        self.visit_function(root, ScopeFlags::Function);

        self.closures
    }

    fn collect_site(&mut self, site: &Site<'_, 'a>) {
        let span = site.span();
        let Some(flags) = self.sites.get(&span) else { return };

        let captures = self.captures(site);
        let class_dependency = self.depends_on_class(site)
            || captures.iter().any(|capture| capture.this_derived);

        self.closures.push(Candidate {
            span,
            captures,
            class_dependency,
            usage: self.usage(span),
            forwarder: self.forwarder(site),
            executes_in_render: self.member_is_render && flags.executes_in_render,
        });
    }

    /// What the closure reads out of the member it was written in.
    fn captures(&self, site: &Site<'_, 'a>) -> Vec<Capture<'a>> {
        let mut collector = CaptureCollector {
            scoping: self.semantic.scoping(),
            symbols: Vec::new(),
            names: Vec::new(),
            written: Vec::new(),
        };

        site.walk_into(&mut collector);

        let mut captures = Vec::new();

        for (index, symbol) in collector.symbols.iter().enumerate() {
            let declaration = self.semantic.scoping().symbol_span(*symbol);

            // A binding the closure declares itself, or one from outside the member that it merely
            // passes through, is not a capture of the member.
            if contains(site.span(), declaration) || !contains(self.member_span, declaration) {
                continue;
            }

            let written_after_init = written_after_init(*symbol, self.semantic, self.member_span);

            captures.push(Capture {
                name: collector.names[index],
                this_derived: this_derived(*symbol, self.semantic, written_after_init),
                written_by_closure: collector.written[index],
                written_after_init,
            });
        }

        captures
    }

    /// Whether the closure's whole extent needs the class it was written in.
    fn depends_on_class(&self, site: &Site<'_, 'a>) -> bool {
        let mut scan = DependencyScan { type_parameters: Vec::new(), found: false };

        site.walk_into(&mut scan);

        scan.found
    }

    /// Whether the closure is bound to a name that is only ever called.
    fn usage(&self, span: Span) -> Usage<'a> {
        let Some(declarator) =
            self.declarators.iter().find(|declarator| declarator.init == Some(span))
        else {
            return Usage::Callback;
        };

        let held = match declarator.kind {
            VariableDeclarationKind::Const => true,
            // A `let` that anything reassigns is not a name the method can take over.
            VariableDeclarationKind::Let => {
                !written_after_init(declarator.symbol, self.semantic, self.member_span)
            }
            _ => false,
        };

        if !held {
            return Usage::Callback;
        }

        // Every use in the member must be a call: passing it, returning it or storing it somewhere
        // else means the name is not the closure's identity.
        let called = self.semantic.scoping().get_resolved_references(declarator.symbol).all(
            |reference| {
                let reference_span = self.semantic.reference_span(reference);

                contains(self.member_span, reference_span)
                    && matches!(
                        self.semantic.nodes().parent_kind(reference.node_id()),
                        AstKind::CallExpression(call) if call.callee.span() == reference_span
                    )
            },
        );

        if called {
            Usage::DirectHelper(declarator.name)
        } else {
            Usage::Callback
        }
    }

    /// The method the closure forwards to, when it forwards to exactly one.
    fn forwarder(&self, site: &Site<'_, 'a>) -> Option<Forwarder<'a>> {
        let Site::Arrow(arrow) = site else { return None };

        forwarder(arrow, self.semantic.scoping())
    }
}

impl<'a, 's> Visit<'a> for Collect<'a, 's> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if function.node_id() != self.root_id
            && function.r#type == FunctionType::FunctionExpression
        {
            self.collect_site(&Site::Expression(function));
        }

        walk::walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.collect_site(&Site::Arrow(arrow));

        walk::walk_arrow_function_expression(self, arrow);
    }
}

/// Whether the member's signature and body need the class it was written in.
fn member_class_dependency<'a>(
    root: &Function<'a>,
    member_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    let mut scan = DependencyScan {
        type_parameters: class_type_parameters(semantic, member_id),
        found: false,
    };

    scan.visit_function(root, ScopeFlags::Function);

    scan.found
}

/// The enclosing class's own type parameters, which name the class without naming it.
fn class_type_parameters<'s>(semantic: &Semantic<'s>, member_id: NodeId) -> Vec<&'s str> {
    semantic
        .nodes()
        .ancestor_kinds(member_id)
        .find_map(|kind| match kind {
            AstKind::Class(class) => Some(class),
            _ => None,
        })
        .map_or_else(Vec::new, |class| {
            class.type_parameters.as_ref().map_or_else(Vec::new, |declaration| {
                declaration.params.iter().map(|parameter| parameter.name.name.as_str()).collect()
            })
        })
}

/// Looks for the nodes that tie a member or a closure to the class it was written in.
struct DependencyScan<'s> {
    /// The enclosing class's own type parameters, which are the class under another name.
    type_parameters: Vec<&'s str>,
    found: bool,
}

impl<'a, 's> Visit<'a> for DependencyScan<'s> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_this_expression(&mut self, expression: &ThisExpression) {
        self.found = true;

        walk::walk_this_expression(self, expression);
    }

    fn visit_super(&mut self, expression: &Super) {
        self.found = true;

        walk::walk_super(self, expression);
    }

    fn visit_private_field_expression(&mut self, expression: &PrivateFieldExpression<'a>) {
        self.found = true;

        walk::walk_private_field_expression(self, expression);
    }

    fn visit_private_in_expression(&mut self, expression: &PrivateInExpression<'a>) {
        self.found = true;

        walk::walk_private_in_expression(self, expression);
    }

    fn visit_ts_this_type(&mut self, expression: &TSThisType) {
        self.found = true;

        walk::walk_ts_this_type(self, expression);
    }

    fn visit_ts_type_name(&mut self, name: &TSTypeName<'a>) {
        if matches!(name, TSTypeName::ThisExpression(_)) {
            self.found = true;
        }

        walk::walk_ts_type_name(self, name);
    }

    fn visit_ts_type_reference(&mut self, reference: &TSTypeReference<'a>) {
        if let TSTypeName::IdentifierReference(name) = &reference.type_name {
            if self.type_parameters.iter().any(|parameter| *parameter == name.name.as_str()) {
                self.found = true;
            }
        }

        walk::walk_ts_type_reference(self, reference);
    }
}

/// Collects the resolved references inside one candidate, in first-use order.
struct CaptureCollector<'a, 's> {
    scoping: &'s Scoping,
    symbols: Vec<SymbolId>,
    names: Vec<&'a str>,
    written: Vec<bool>,
}

impl<'a> Visit<'a> for CaptureCollector<'a, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference_id) = identifier.reference_id.get() else { return };
        let reference = self.scoping.get_reference(reference_id);
        let flags = reference.flags();

        // A TypeScript type position carries neither Read nor Write, and oxc's binder has already
        // worked out which is which.
        if !flags.intersects(ReferenceFlags::Read | ReferenceFlags::Write) {
            return;
        }

        let Some(symbol) = reference.symbol_id() else { return };

        if let Some(index) = self.symbols.iter().position(|held| *held == symbol) {
            self.written[index] |= flags.contains(ReferenceFlags::Write);

            return;
        }

        self.symbols.push(symbol);
        self.names.push(identifier.name.as_str());
        self.written.push(flags.contains(ReferenceFlags::Write));
    }
}

/// Whether anything in the member assigns to `symbol` after it was initialised.
fn written_after_init(
    symbol: SymbolId,
    semantic: &Semantic<'_>,
    member_span: Span,
) -> bool {
    semantic.scoping().get_resolved_references(symbol).any(|reference| {
        reference.flags().contains(ReferenceFlags::Write)
            && contains(member_span, semantic.reference_span(reference))
    })
}

/// Whether `symbol` was destructured straight off `this`: `const { id } = this.data`.
fn this_derived(symbol: SymbolId, semantic: &Semantic<'_>, written_after_init: bool) -> bool {
    // A closure that writes the binding owns it rather than reading it out of the class.
    if written_after_init {
        return false;
    }

    let AstKind::VariableDeclarator(declarator) = semantic.symbol_declaration(symbol).kind() else {
        return false;
    };
    let AstKind::VariableDeclaration(declaration) =
        semantic.nodes().parent_kind(declarator.node_id())
    else {
        return false;
    };

    declaration.kind == VariableDeclarationKind::Const
        && declarator.init.as_ref().is_some_and(|init| is_this_chain(init))
        && pattern_binds(&declarator.id, symbol)
}

/// Whether `symbol` is bound by a plain property of the pattern's object part.
///
/// A rest element is a different shape from the property it shadows, and an array pattern says
/// nothing about where the value came from, so neither counts.
fn pattern_binds(pattern: &BindingPattern<'_>, symbol: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id.get() == Some(symbol),
        BindingPattern::AssignmentPattern(pattern) => pattern_binds(&pattern.left, symbol),
        BindingPattern::ObjectPattern(object) => {
            object.properties.iter().any(|property| pattern_binds(&property.value, symbol))
        }
        BindingPattern::ArrayPattern(_) => false,
    }
}

/// Whether an expression is a chain of plain members hanging off `this`.
fn is_this_chain(expression: &Expression<'_>) -> bool {
    // `chain_root` walks past a computed member and still reports `Base::This`, which is why the
    // walk is redone here: a computed key or a call makes the chain unknowable.
    matches!(chain_root(expression).base, Base::This)
        && match expression {
            Expression::StaticMemberExpression(member) => is_this_chain(&member.object),
            Expression::ParenthesizedExpression(inner) => is_this_chain(&inner.expression),
            Expression::TSAsExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSSatisfiesExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSNonNullExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSTypeAssertion(cast) => is_this_chain(&cast.expression),
            Expression::ThisExpression(_) => true,
            _ => false,
        }
}

/// Whether a closure is nothing but forwarding to a method: `() => this.m(a, b)`.
fn forwarder<'a>(arrow: &ArrowFunctionExpression<'a>, scoping: &Scoping) -> Option<Forwarder<'a>> {
    if arrow.params.rest.is_some() {
        return None;
    }

    // A plain identifier per parameter: a pattern, a default or a rest would have to be carried
    // over as well, and a forwarder that carries anything is not one.
    let parameters = arrow
        .params
        .items
        .iter()
        .map(|parameter| {
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };

            if parameter.initializer.is_some() {
                return None;
            }

            identifier.symbol_id.get()
        })
        .collect::<Option<Vec<_>>>()?;

    let expression = match &arrow.body {
        ArrowFunctionBody::FunctionBody(body) => {
            let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                return None;
            };

            statement.argument.as_ref()?
        }
        _ => arrow.body.as_expression()?,
    };

    let Expression::CallExpression(call) = expression else { return None };
    let Expression::StaticMemberExpression(member) = &call.callee else { return None };

    if !matches!(member.object, Expression::ThisExpression(_)) {
        return None;
    }

    // The call forwards the parameters, in the order they were declared, and nothing else: a
    // computed or captured argument would make the method body depend on the closure it came from.
    let forwards = call.arguments.len() == parameters.len()
        && call.arguments.iter().zip(&parameters).all(|(argument, parameter)| {
            match argument.as_expression() {
                Some(Expression::Identifier(identifier)) => identifier
                    .reference_id
                    .get()
                    .is_some_and(|id| scoping.get_reference(id).symbol_id() == Some(*parameter)),
                _ => false,
            }
        });

    forwards.then(|| Forwarder { method: member.property.name.as_str() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// Parses a TSX snippet and hands the program and its semantic model to `check`.
    fn parse(text: &str, check: impl FnOnce(&Program<'_>, &Semantic<'_>)) {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(parsed.diagnostics.is_empty(), "test source must parse: {:?}", parsed.diagnostics);

        let semantic = build_semantic(&parsed.program);

        check(&parsed.program, &semantic);
    }

    /// The members of the snippet: the first method, the first field, and every class.
    #[derive(Default)]
    struct Members<'a> {
        method: Option<&'a MethodDefinition<'a>>,
        field: Option<&'a PropertyDefinition<'a>>,
        classes: Vec<&'a Class<'a>>,
    }

    impl<'a> Visit<'a> for Members<'a> {
        // The walk hands each node over as an `AstKind`, whose variant carries the node with the
        // program's own lifetime — which is the lifetime the member finders below have to return.
        fn enter_node(&mut self, kind: AstKind<'a>) {
            match kind {
                AstKind::Class(class) => self.classes.push(class),
                AstKind::MethodDefinition(method) if self.method.is_none() => {
                    self.method = Some(method);
                }
                AstKind::PropertyDefinition(field) if self.field.is_none() => {
                    self.field = Some(field);
                }
                _ => {}
            }
        }
    }

    fn members<'a>(program: &'a Program<'a>) -> Members<'a> {
        let mut members = Members::default();

        members.visit_program(program);

        members
    }

    fn first_method<'a>(program: &'a Program<'a>) -> &'a MethodDefinition<'a> {
        members(program).method.expect("test source must contain a method")
    }

    fn first_field<'a>(program: &'a Program<'a>) -> &'a PropertyDefinition<'a> {
        members(program).field.expect("test source must contain a field")
    }

    fn class_named<'a>(program: &'a Program<'a>, name: &str) -> &'a Class<'a> {
        let found = members(program)
            .classes
            .into_iter()
            .find(|class| class.id.as_ref().is_some_and(|id| id.name.as_str() == name));

        found.expect("test source must contain the class")
    }

    /// Analyzes the snippet's first method, in or out of render.
    fn method_analysis(text: &str, render: bool, check: impl FnOnce(MemberAnalysis<'_>)) {
        parse(text, |program, semantic| {
            check(analyze_method(first_method(program), semantic, render));
        });
    }

    fn component_class(text: &str, name: &str, check: impl FnOnce(bool)) {
        parse(text, |program, semantic| {
            check(is_component_class(class_named(program, name), semantic));
        });
    }

    fn field_analysis(text: &str, render: bool, check: impl FnOnce(MemberAnalysis<'_>)) {
        parse(text, |program, semantic| {
            check(analyze_field(first_field(program), semantic, render));
        });
    }

    /// Each capture flattened to name, this-derived, written-by-closure, written-after-init, in
    /// first-use order.
    fn captures_digest<'a>(candidate: &'a Candidate<'a>) -> Vec<(&'a str, bool, bool, bool)> {
        candidate
            .captures
            .iter()
            .map(|capture| {
                (
                    capture.name,
                    capture.this_derived,
                    capture.written_by_closure,
                    capture.written_after_init,
                )
            })
            .collect()
    }

    #[test]
    fn an_inner_binding_shadows_the_outer_one_of_the_same_name() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const x = this.props.x;
        const outer = () => {
            const x = 2;
            const inner = () => x;
            return inner;
        };
        return outer;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 2);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );

                assert_eq!(captures_digest(&analysis.closures[1]), [("x", false, false, false)]);
            },
        );
    }

    #[test]
    fn a_hoisted_var_and_a_function_declaration_are_captures() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const read = () => value + helper();
        var value = 3;
        function helper() {
            return 1;
        }
        return read;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 1);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("value", false, false, false), ("helper", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_destructured_parameter_with_defaults_is_captured() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render({ width = 10, height = 20 }: { width?: number; height?: number } = {}) {
        return [1].map(() => width * height);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("width", false, false, false), ("height", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_for_of_head_binding_is_captured() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const handlers = [];
        for (const id of this.ids) {
            handlers.push(() => id);
        }
        return handlers;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(captures_digest(&analysis.closures[0]), [("id", false, false, false)]);
            },
        );
    }

    #[test]
    fn a_catch_parameter_is_captured_and_an_unresolved_name_is_not() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        try {
            return [1].map(() => risky());
        } catch (problem) {
            return [1].map(() => problem.message);
        }
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 2);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );

                assert_eq!(
                    captures_digest(&analysis.closures[1]),
                    [("problem", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_named_function_expressions_own_name_is_not_a_capture() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const factory = function repeat(limit: number): number {
            return limit <= 0 ? 0 : repeat(limit - 1);
        };
        return factory;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 1);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );
            },
        );
    }

    #[test]
    fn a_type_annotation_reference_is_not_a_capture() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const Props = { width: 1 };
        const take = (shape: Props) => shape.width;
        return take;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 1);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );
            },
        );
    }

    #[test]
    fn a_typeof_type_position_reference_is_not_a_capture() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const shape = { width: 1 };
        const clone = (other: typeof shape): typeof shape => other;
        return clone;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 1);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );
            },
        );
    }

    #[test]
    fn a_jsx_component_name_at_module_level_is_not_a_capture() {
        method_analysis(
            r#"
const TodoItem = (props: { id: string }) => null;

class Widget extends AntiHookComponent {
    render() {
        return [1].map((id) => <TodoItem id={id}/>);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(analysis.closures.len(), 1);

                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [] as [(&str, bool, bool, bool); 0]
                );
            },
        );
    }

    #[test]
    fn a_jsx_component_name_declared_in_the_member_is_a_value_capture() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const Row = this.makeRow;
        return () => <Row/>;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(captures_digest(&analysis.closures[0]), [("Row", true, false, false)]);
            },
        );
    }

    #[test]
    fn an_object_shorthand_property_is_a_value_capture() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render(props: { carburetor: number }) {
        const carburetor = props.carburetor;
        return [1].map((id) => ({ id, carburetor }));
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("carburetor", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn an_assignment_inside_the_closure_marks_the_capture_written() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let count = 0;
        const set = () => {
            count = count + 1;
        };
        return [set, count];
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(captures_digest(&analysis.closures[0]), [("count", false, true, true)]);
            },
        );
    }

    #[test]
    fn a_compound_assignment_marks_the_capture_written() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let total = 0;
        let count = 0;
        const add = () => {
            total += count;
        };
        return [add];
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("total", false, true, true), ("count", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn an_increment_marks_the_capture_written() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let first = 0;
        const bump = () => first++;
        return [bump];
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(captures_digest(&analysis.closures[0]), [("first", false, true, true)]);
            },
        );
    }

    #[test]
    fn a_destructuring_assignment_marks_the_capture_written() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let count = 0;
        let pair = { value: 0 };
        const spread = () => ({ count } = pair);
        return [spread];
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("count", false, true, true), ("pair", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_write_later_in_the_member_marks_the_capture_written_after_init() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let later = 1;
        const read = () => later;
        later = 2;
        return read;
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(captures_digest(&analysis.closures[0]), [("later", false, false, true)]);
            },
        );
    }

    #[test]
    fn a_const_local_chained_off_this_is_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const current = this.state.items;
        return [1].map(() => current.length);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("current", true, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_cast_still_leaves_the_chain_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const current = this.props as { id: number };
        return [1].map(() => current.id);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("current", true, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_destructured_this_chain_is_this_derived_for_each_plain_property() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const { carburetor, id: key } = this.props as { carburetor: number; id: number };
        return [1].map(() => carburetor + key);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("carburetor", true, false, false), ("key", true, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_rest_property_of_a_this_chain_is_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const { id, ...others } = this.props as Record<string, number>;
        return [1].map(() => id + others.x);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("id", true, false, false), ("others", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_computed_member_off_this_is_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const field = "width";
        const picked = this.props[field];
        return [1].map(() => picked);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("picked", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_call_off_this_is_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const current = this.getData();
        return [1].map(() => current);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("current", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_reassigned_let_off_this_is_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let current = this.props;
        current = {} as { id: number };
        return [1].map(() => current);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("current", false, false, true)]
                );
            },
        );
    }

    #[test]
    fn a_never_reassigned_let_off_this_is_still_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        let current = this.props;
        return [1].map(() => current);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("current", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn an_optional_chain_off_this_is_not_this_derived() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const maybe = this.props?.extra;
        return [1].map(() => maybe);
    }
}
"#,
            true,
            |analysis| {
                assert_eq!(
                    captures_digest(&analysis.closures[0]),
                    [("maybe", false, false, false)]
                );
            },
        );
    }

    #[test]
    fn a_direct_component_base_is_a_component() {
        component_class(
            r#"class Widget extends AntiHookComponent { render() { return null; } }"#,
            "Widget",
            |component| assert!(component),
        );

        component_class(
            r#"class Widget extends ScopedAntiHookComponent { render() { return null; } }"#,
            "Widget",
            |component| assert!(component),
        );
    }

    #[test]
    fn a_class_without_heritage_is_not_a_component() {
        component_class(
            r#"class Widget { render() { return null; } }"#,
            "Widget",
            |component| assert!(!component),
        );
    }

    #[test]
    fn a_same_file_subclass_of_a_component_is_a_component() {
        let text = r#"
class MyBase extends AntiHookComponent {}

class Widget extends MyBase {}
"#;

        component_class(text, "Widget", |component| assert!(component));

        component_class(text, "MyBase", |component| assert!(component));
    }

    #[test]
    fn a_three_level_same_file_chain_is_a_component() {
        component_class(
            r#"
class Ground extends AntiHookComponent {}

class Middle extends Ground {}

class Top extends Middle {}
"#,
            "Top",
            |component| assert!(component),
        );
    }

    #[test]
    fn a_subclass_of_an_imported_base_is_not_a_component() {
        component_class(
            r#"
import { External } from "./external";

class Widget extends External {
    render() {
        return null;
    }
}
"#,
            "Widget",
            |component| assert!(!component),
        );
    }

    #[test]
    fn a_same_file_heritage_cycle_terminates_as_not_a_component() {
        let cycle = r#"
class LoopA extends LoopB {}

class LoopB extends LoopA {}
"#;

        component_class(cycle, "LoopA", |component| assert!(!component));

        component_class(cycle, "LoopB", |component| assert!(!component));

        component_class(r#"class Ouro extends Ouro {}"#, "Ouro", |component| assert!(!component));
    }

    #[test]
    fn a_store_class_and_its_subclass_are_not_components() {
        let text = r#"
class MyStore extends Carburetor {}

class SubStore extends MyStore {}
"#;

        component_class(text, "MyStore", |component| assert!(!component));

        component_class(text, "SubStore", |component| assert!(!component));
    }

    #[test]
    fn a_prop_closure_on_a_component_element_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        return <Child onClick={() => this.handle()} />;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn a_prop_closure_on_a_dom_element_is_not_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        return <div onClick={() => this.handle()} />;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 1),
        );
    }

    #[test]
    fn a_library_callback_argument_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    componentDidMount() {
        useEffect(() => this.subscribe());
    }
}
"#,
            false,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn a_render_closure_reading_tracked_data_stays_in_render() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        return this.items.map(item => this.getData(item));
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn the_same_tracked_call_outside_render_is_not_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    componentDidMount() {
        return this.items.map(item => this.getData(item));
    }
}
"#,
            false,
            |analysis| assert_eq!(analysis.closures.len(), 1),
        );
    }

    #[test]
    fn a_closure_inside_an_arrow_class_field_initializer_is_not_analyzed() {
        field_analysis(
            r#"
class Widget extends AntiHookComponent {
    onClick = () => {
        const inner = () => this.handle();
        return inner;
    };
}
"#,
            false,
            |analysis| {
                assert_eq!(analysis.closures.len(), 0);
                // No closure is collected from the arrow field, but the member-level dependency is
                // still computed: the field's body reads `this.handle`, so it needs the class.
                assert!(analysis.class_dependency);
            },
        );
    }

    #[test]
    fn a_closure_assigned_to_this_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    constructor() {
        this.onClick = () => this.handle();
    }
}
"#,
            false,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn a_function_expression_using_this_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = function () { return this.value; };
        return handler;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn a_function_expression_using_arguments_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = function () { return arguments.length; };
        return handler;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn a_function_expression_using_new_target_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = function () { return new.target; };
        return handler;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn an_iife_is_excluded() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        const value = (() => this.compute())();
        return value;
    }
}
"#,
            true,
            |analysis| assert_eq!(analysis.closures.len(), 0),
        );
    }

    #[test]
    fn this_inside_a_nested_plain_function_still_marks_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const handler = function () { return this.value; };
        return handler;
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn super_marks_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        return super.render();
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn a_private_field_read_marks_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    #secret = 1;
    method() {
        return this.#secret;
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn a_private_in_check_marks_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    #secret = 1;
    method() {
        return #secret in this;
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn a_this_type_position_marks_the_member_class_dependent_without_a_this_value() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method(other: this): void {
        void other;
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn a_class_type_parameter_reference_marks_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget<T> extends AntiHookComponent {
    method(value: T): void {
        void value;
    }
}
"#,
            false,
            |analysis| assert!(analysis.class_dependency),
        );
    }

    #[test]
    fn an_unrelated_type_reference_does_not_mark_the_member_class_dependent() {
        method_analysis(
            r#"
class Widget<T> extends AntiHookComponent {
    method(value: number): void {
        void value;
    }
}
"#,
            false,
            |analysis| assert!(!analysis.class_dependency),
        );
    }

    #[test]
    fn a_closure_only_ever_called_is_a_direct_helper() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const helper = () => this.compute();
        return helper() + helper();
    }
}
"#,
            false,
            |analysis| {
                assert!(matches!(analysis.closures[0].usage, Usage::DirectHelper("helper")));
            },
        );
    }

    #[test]
    fn a_closure_passed_somewhere_is_a_callback() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const helper = () => this.compute();
        return [1].map(helper);
    }
}
"#,
            false,
            |analysis| {
                assert!(matches!(analysis.closures[0].usage, Usage::Callback));
            },
        );
    }

    #[test]
    fn a_reassigned_let_closure_is_a_callback_even_when_only_called() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method(flag) {
        let helper = () => this.compute();
        if (flag) {
            helper = null;
        }
        return helper();
    }
}
"#,
            false,
            |analysis| {
                assert!(matches!(analysis.closures[0].usage, Usage::Callback));
            },
        );
    }

    #[test]
    fn a_pure_forward_to_a_method_is_a_forwarder() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const forward = (a, b) => this.handle(a, b);
        return forward;
    }
}
"#,
            false,
            |analysis| {
                let forwarder = analysis.closures[0].forwarder.as_ref().expect("must forward");

                assert_eq!(forwarder.method, "handle");
            },
        );
    }

    #[test]
    fn an_extra_argument_is_not_a_forwarder() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const notForward = (a, b) => this.handle(a, b, 1);
        return notForward;
    }
}
"#,
            false,
            |analysis| assert!(analysis.closures[0].forwarder.is_none()),
        );
    }

    #[test]
    fn a_reordered_argument_is_not_a_forwarder() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const notForward = (a, b) => this.handle(b, a);
        return notForward;
    }
}
"#,
            false,
            |analysis| assert!(analysis.closures[0].forwarder.is_none()),
        );
    }

    #[test]
    fn a_rest_parameter_forward_is_not_a_forwarder() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        const notForward = (...args) => this.handle(...args);
        return notForward;
    }
}
"#,
            false,
            |analysis| assert!(analysis.closures[0].forwarder.is_none()),
        );
    }

    #[test]
    fn a_synchronous_callback_in_render_executes_in_render() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        return this.items.map(item => this.renderItem(item));
    }
}
"#,
            true,
            |analysis| assert!(analysis.closures[0].executes_in_render),
        );
    }

    #[test]
    fn the_same_closure_outside_a_render_member_does_not_execute_in_render() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    method() {
        return this.items.map(item => this.renderItem(item));
    }
}
"#,
            false,
            |analysis| assert!(!analysis.closures[0].executes_in_render),
        );
    }

    #[test]
    fn a_closure_handed_to_settimeout_in_render_does_not_execute_in_render() {
        method_analysis(
            r#"
class Widget extends AntiHookComponent {
    render() {
        setTimeout(() => this.recompute(), 0);
        return null;
    }
}
"#,
            true,
            |analysis| assert!(!analysis.closures[0].executes_in_render),
        );
    }
}
