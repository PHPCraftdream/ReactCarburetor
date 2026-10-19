//! The walk every rule shares: where in the code we are, and whether it runs during a render.
//!
//! The JavaScript plugin answers "is this inside render?" by climbing parent pointers from the
//! node. oxc's visitor has no parents, and it does not need them: walking downwards, the answer is
//! already known by the time a node is reached, so the context is maintained on the way in and
//! restored on the way out. The same reasoning as the plugin's, arrived at from the other side.
//!
//! A rule implements [`Rule`] and receives the nodes it cares about together with that context, so
//! no rule repeats the class, member and callback bookkeeping.

use std::collections::HashSet;

mod component;
pub(crate) mod functions;

use oxc_ast::ast::{
    Argument, ArrowFunctionExpression, AssignmentExpression, CallExpression, Class, Expression,
    Function, IdentifierReference, JSXAttribute, JSXElementName, JSXMemberExpression,
    JSXMemberExpressionObject, MemberExpression, MethodDefinition, Program, PropertyDefinition,
    UnaryExpression, UpdateExpression, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::support::bases::{
    Bases, ClassChains, ARRAY_MUTATORS, RENDER_METHODS, SYNCHRONOUS_CALLBACKS,
};
use crate::rules::support::chain::{assignment_root, chain_root, simple_target_root, ChainRoot};
use crate::rules::support::names::{member_call_name, property_key_name, unwrap_expression};
use crate::Diagnostic;
use component::discover;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderKind {
    Class,
    Function,
}

/// Where the walk currently is.
pub struct Context {
    /// The innermost enclosing class extends a component base.
    pub in_component: bool,
    /// The innermost enclosing class extends a carburetor base.
    pub in_carburetor: bool,
    /// The class member being walked, when its name is knowable statically.
    pub member: Option<String>,
    /// That member's source range, which is the only stable identity a method has.
    pub member_span: Option<Span>,
    /// The span of the innermost enclosing class, the only stable identity a class has.
    pub class_span: Option<Span>,
    /// The tag name of the JSX element an attribute belongs to.
    ///
    /// oxc's AST carries no parent pointer, so an attribute cannot look upward for its opening
    /// element the way the JS plugin's pseudo-AST does; the walker records the name on the way
    /// down instead.
    pub jsx_element: Option<String>,
    /// Whether the JSX element is a component rather than a lowercase DOM tag.
    pub jsx_component: bool,
    /// The walk is inside an `update(...)` callback, which publishes when it returns.
    pub in_update: bool,
    /// The name that callback gave its draft parameter, when it named one.
    pub update_draft: Option<String>,
    /// The node executes while a component renders — not merely that render encloses it.
    pub in_render: bool,
    /// Whether this render is a class member or a function component.
    pub render_kind: Option<RenderKind>,
    /// The owning component render span, preserved inside synchronous callbacks.
    pub render_scope: Option<Span>,
    /// The innermost enclosing function, or the whole program at module level.
    ///
    /// A rule that remembers what a name is bound to needs it: with no scope analyser, the span is
    /// what keeps a same-named local in another function from being mistaken for the tracked one.
    pub function: Span,
}

impl Context {
    /// A context outside any class or function: module level.
    fn top(program: Span) -> Context {
        Context {
            in_component: false,
            in_carburetor: false,
            member: None,
            member_span: None,
            class_span: None,
            jsx_element: None,
            jsx_component: false,
            in_update: false,
            update_draft: None,
            in_render: false,
            render_kind: None,
            render_scope: None,
            function: program,
        }
    }

    /// Whether a node sits inside a remembered function span.
    pub fn within(span: Span, container: Span) -> bool {
        span.start >= container.start && span.end <= container.end
    }
}

/// What a rule implements. Every method is optional; a rule overrides the node kinds it is about.
pub trait Rule<'a> {
    /// The diagnostics collected during the walk.
    fn finish(&mut self) -> Vec<Diagnostic>;
    /// `f(...)`, including every method call.
    fn call(&mut self, _call: &CallExpression<'a>, _context: &Context) {}
    /// A call after its arguments and callback bodies have been walked.
    fn leave_call(&mut self, _call: &CallExpression<'a>, _context: &Context) {}
    /// A mutation in any of its four forms: `x.y = v`, `x.y++`, `delete x.y`, `x.y.push(v)`.
    ///
    /// A write rule that handled only assignment would miss three of them, so the walk normalises
    /// all four into the chain being changed and the node worth reporting on.
    fn mutation(&mut self, _root: &ChainRoot<'_, 'a>, _span: Span, _context: &Context) {}
    /// `const x = init`, for a rule that has to remember what a name is bound to.
    fn declarator(&mut self, _declarator: &VariableDeclarator<'a>, _context: &Context) {}
    /// Every mention of a name, for a rule that follows where a binding travels.
    fn identifier(&mut self, _identifier: &IdentifierReference<'a>, _context: &Context) {}
    /// `a = b` and its compound forms, unnormalised.
    fn assignment(&mut self, _expression: &AssignmentExpression<'a>, _context: &Context) {}
    /// `x++`, `--x`.
    fn update(&mut self, _expression: &UpdateExpression<'a>, _context: &Context) {}
    /// `delete x`, `!x`, and the rest.
    fn unary(&mut self, _expression: &UnaryExpression<'a>, _context: &Context) {}
    /// `object.property`, computed or not.
    fn member(&mut self, _expression: &MemberExpression<'a>, _context: &Context) {}
    /// A class property, before its value is walked.
    fn property(&mut self, _property: &PropertyDefinition<'a>, _context: &Context) {}
    /// A class method, before its body is walked.
    fn method(&mut self, _method: &MethodDefinition<'a>, _context: &Context) {}
    /// A JSX attribute, `onClick={...}` among them.
    fn jsx_attribute(&mut self, _attribute: &JSXAttribute<'a>, _context: &Context) {}
    /// A class, once `context.in_component` / `context.in_carburetor` reflect it.
    fn class(&mut self, _class: &Class<'a>, _context: &Context) {}
    /// `function inner() {}`, called while the enclosing context is still the render body.
    fn function_declaration(&mut self, _function: &Function<'a>, _context: &Context) {}
}

/// The first parameter of a call's callback argument, which is how a draft or a reader is named.
fn callback_parameter<'a>(call: &'a CallExpression<'a>) -> Option<&'a str> {
    let parameters = match call.arguments.first() {
        Some(Argument::ArrowFunctionExpression(body)) => &body.params,
        Some(Argument::FunctionExpression(body)) => &body.params,
        _ => return None,
    };

    parameters
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|identifier| identifier.name.as_str())
}

/// Drives rules over one parsed file, maintaining the context they read.
struct Walk<'a, 'b> {
    rules: Vec<&'b mut dyn Rule<'a>>,
    bases: &'a Bases,
    chains: ClassChains,
    context: Context,
    /// Spans of functions handed to a synchronous-callback method, which therefore run in place.
    synchronous: HashSet<Span>,
    /// Spans of functions that *are* a class member's body, which must not count as nesting.
    member_bodies: HashSet<Span>,
    component_functions: HashSet<Span>,
    marker: std::marker::PhantomData<&'a ()>,
}

impl<'a, 'b> Walk<'a, 'b> {
    /// Enters a function body and returns the context to restore.
    fn enter_function(&mut self, span: Span) -> (bool, Option<RenderKind>, Span, Option<Span>) {
        let was = (
            self.context.in_render,
            self.context.render_kind,
            self.context.function,
            self.context.render_scope,
        );

        if !self.member_bodies.contains(&span) && !self.synchronous.contains(&span) {
            self.context.in_render = false;
            self.context.render_kind = None;
            self.context.render_scope = None;
        }
        self.context.function = span;
        was
    }
}

impl<'a, 'b> Visit<'a> for Walk<'a, 'b> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let outer_component = self.context.in_component;
        let outer_carburetor = self.context.in_carburetor;
        let outer_member = self.context.member.take();
        let outer_render = self.context.in_render;
        let outer_kind = self.context.render_kind;
        let outer_class = self.context.class_span;
        let outer_scope = self.context.render_scope;

        self.context.in_component = self
            .chains
            .reaches(class, |name| self.bases.is_component(name));
        self.context.in_carburetor = self.chains.reaches(class, |name| self.bases.is_store(name));
        self.context.class_span = Some(class.span);
        self.context.in_render = false;
        self.context.render_kind = None;
        self.context.render_scope = None;

        for rule in &mut self.rules {
            rule.class(class, &self.context);
        }
        walk::walk_class(self, class);

        self.context.in_component = outer_component;
        self.context.in_carburetor = outer_carburetor;
        self.context.member = outer_member;
        self.context.class_span = outer_class;
        self.context.in_render = outer_render;
        self.context.render_kind = outer_kind;
        self.context.render_scope = outer_scope;
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let outer_member = self.context.member.take();
        let outer_span = self.context.member_span;
        let outer_render = self.context.in_render;
        let outer_kind = self.context.render_kind;
        let outer_scope = self.context.render_scope;
        let name = property_key_name(&method.key).map(str::to_string);

        self.context.in_render = self.context.in_component
            && name
                .as_deref()
                .is_some_and(|name| RENDER_METHODS.contains(&name));
        self.context.render_kind = self.context.in_render.then_some(RenderKind::Class);
        self.context.render_scope = self.context.in_render.then_some(method.value.span);
        self.context.member = name;
        self.context.member_span = Some(method.span);

        for rule in &mut self.rules {
            rule.method(method, &self.context);
        }
        self.member_bodies.insert(method.value.span);
        walk::walk_method_definition(self, method);

        self.context.member = outer_member;
        self.context.member_span = outer_span;
        self.context.in_render = outer_render;
        self.context.render_kind = outer_kind;
        self.context.render_scope = outer_scope;
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        let outer_member = self.context.member.take();
        let outer_span = self.context.member_span;
        let outer_render = self.context.in_render;
        let outer_kind = self.context.render_kind;
        let outer_scope = self.context.render_scope;
        let name = property_key_name(&property.key).map(str::to_string);

        // A lifecycle method written as a property is still a render body for other rules.
        self.context.in_render = self.context.in_component
            && name
                .as_deref()
                .is_some_and(|name| RENDER_METHODS.contains(&name));
        self.context.render_kind = self.context.in_render.then_some(RenderKind::Class);
        self.context.member = name;
        self.context.member_span = Some(property.span);
        for rule in &mut self.rules {
            rule.property(property, &self.context);
        }

        if let Some(value) = &property.value {
            self.context.render_scope = self.context.in_render.then_some(value.span());
            self.member_bodies.insert(value.span());
        }
        walk::walk_property_definition(self, property);

        self.context.member = outer_member;
        self.context.member_span = outer_span;
        self.context.in_render = outer_render;
        self.context.render_kind = outer_kind;
        self.context.render_scope = outer_scope;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if function.is_function_declaration() {
            for rule in &mut self.rules {
                rule.function_declaration(function, &self.context);
            }
        }
        let (render, render_kind, enclosing, render_scope) = self.enter_function(function.span);
        if self.component_functions.contains(&function.span) {
            self.context.in_render = true;
            self.context.render_kind = Some(RenderKind::Function);
            self.context.render_scope = Some(function.span);
        }
        walk::walk_function(self, function, flags);
        self.context.in_render = render;
        self.context.render_kind = render_kind;
        self.context.function = enclosing;
        self.context.render_scope = render_scope;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let (was_render, previous_kind, enclosing, render_scope) = self.enter_function(arrow.span);
        if self.component_functions.contains(&arrow.span) {
            self.context.in_render = true;
            self.context.render_kind = Some(RenderKind::Function);
            self.context.render_scope = Some(arrow.span);
        }
        walk::walk_arrow_function_expression(self, arrow);
        self.context.in_render = was_render;
        self.context.render_kind = previous_kind;
        self.context.function = enclosing;
        self.context.render_scope = render_scope;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let method = member_call_name(&call.callee);
        let outer_update = self.context.in_update;
        let outer_draft = self.context.update_draft.take();

        if method == Some("update") {
            self.context.in_update = true;
            self.context.update_draft = callback_parameter(call).map(str::to_string);
        } else {
            self.context.update_draft = outer_draft.clone();
        }
        for rule in &mut self.rules {
            rule.call(call, &self.context);
        }

        if let Some(method) = method {
            if ARRAY_MUTATORS.contains(&method) {
                if let Expression::StaticMemberExpression(member) = &call.callee {
                    for rule in &mut self.rules {
                        rule.mutation(&chain_root(&member.object), call.span, &self.context);
                    }
                }
            }
        }

        if method.is_some_and(|name| SYNCHRONOUS_CALLBACKS.contains(&name)) {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    self.synchronous
                        .insert(unwrap_expression(expression).span());
                }
            }
        }
        walk::walk_call_expression(self, call);
        for rule in &mut self.rules {
            rule.leave_call(call, &self.context);
        }
        self.context.in_update = outer_update;
        self.context.update_draft = outer_draft;
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        for rule in &mut self.rules {
            rule.identifier(identifier, &self.context);
        }
        walk::walk_identifier_reference(self, identifier);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        for rule in &mut self.rules {
            rule.assignment(expression, &self.context);
        }
        for rule in &mut self.rules {
            rule.mutation(
                &assignment_root(&expression.left),
                expression.span,
                &self.context,
            );
        }
        walk::walk_assignment_expression(self, expression);
    }

    fn visit_update_expression(&mut self, expression: &UpdateExpression<'a>) {
        for rule in &mut self.rules {
            rule.update(expression, &self.context);
        }
        for rule in &mut self.rules {
            rule.mutation(
                &simple_target_root(&expression.argument),
                expression.span,
                &self.context,
            );
        }
        walk::walk_update_expression(self, expression);
    }

    fn visit_unary_expression(&mut self, expression: &UnaryExpression<'a>) {
        for rule in &mut self.rules {
            rule.unary(expression, &self.context);
        }
        if expression.operator == UnaryOperator::Delete {
            for rule in &mut self.rules {
                rule.mutation(
                    &chain_root(&expression.argument),
                    expression.span,
                    &self.context,
                );
            }
        }
        walk::walk_unary_expression(self, expression);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        for rule in &mut self.rules {
            rule.declarator(declarator, &self.context);
        }
        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_member_expression(&mut self, expression: &MemberExpression<'a>) {
        for rule in &mut self.rules {
            rule.member(expression, &self.context);
        }
        walk::walk_member_expression(self, expression);
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        for rule in &mut self.rules {
            rule.jsx_attribute(attribute, &self.context);
        }
        walk::walk_jsx_attribute(self, attribute);
    }

    fn visit_jsx_opening_element(&mut self, element: &oxc_ast::ast::JSXOpeningElement<'a>) {
        let outer = self.context.jsx_element.take();
        let outer_component = self.context.jsx_component;
        let (name, component) = jsx_element_name(&element.name);
        self.context.jsx_element = name;
        self.context.jsx_component = component;
        walk::walk_jsx_opening_element(self, element);
        self.context.jsx_element = outer;
        self.context.jsx_component = outer_component;
    }
}

fn jsx_element_name(name: &JSXElementName<'_>) -> (Option<String>, bool) {
    match name {
        JSXElementName::Identifier(identifier) => {
            let name = identifier.name.to_string();
            let component = name.chars().next().is_some_and(char::is_uppercase);
            (Some(name), component)
        }
        JSXElementName::IdentifierReference(identifier) => {
            let name = identifier.name.to_string();
            let component = name.chars().next().is_some_and(char::is_uppercase);
            (Some(name), component)
        }
        JSXElementName::MemberExpression(member) => (Some(jsx_member_name(member)), true),
        _ => (None, false),
    }
}

fn jsx_member_name(member: &JSXMemberExpression<'_>) -> String {
    let object = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(member) => jsx_member_name(member),
        JSXMemberExpressionObject::ThisExpression(_) => String::from("this"),
    };
    format!("{object}.{}", member.property.name)
}

#[cfg(test)]
thread_local! {
    static WALK_COUNTS: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) };
}

#[cfg(test)]
pub(in crate::rules) fn reset_test_counts() {
    WALK_COUNTS.with(|counts| counts.set((0, 0)));
}

#[cfg(test)]
pub(in crate::rules) fn test_counts() -> (usize, usize) {
    WALK_COUNTS.with(std::cell::Cell::get)
}

pub fn walk_rule<'a, R: Rule<'a>>(
    program: &'a Program<'a>,
    mut rule: R,
    bases: &'a Bases,
) -> Vec<Diagnostic> {
    walk_rules(program, vec![&mut rule], bases)
}

/// Runs several rules over one parsed file in a single traversal: the shared context is built
/// once and every hook fans out to each rule, so a file costs one walk however many rules run.
/// Each rule's findings come back in the order the rules were handed over.
pub fn walk_rules<'a>(
    program: &'a Program<'a>,
    rules: Vec<&mut dyn Rule<'a>>,
    bases: &'a Bases,
) -> Vec<Diagnostic> {
    #[cfg(test)]
    WALK_COUNTS.with(|counts| {
        let (walks, rule_count) = counts.get();
        counts.set((walks + 1, rule_count + rules.len()));
    });
    let mut walk = Walk {
        rules,
        bases,
        chains: ClassChains::build(program),
        context: Context::top(program.span),
        synchronous: HashSet::new(),
        member_bodies: HashSet::new(),
        component_functions: discover(program),
        marker: std::marker::PhantomData,
    };
    walk.visit_program(program);

    let mut all = Vec::new();

    for rule in walk.rules.drain(..) {
        all.extend(rule.finish());
    }

    all
}

#[cfg(test)]
#[path = "tests.rs"]
mod function_component_tests;
