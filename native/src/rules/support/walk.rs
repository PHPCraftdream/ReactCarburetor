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
    ARRAY_MUTATORS, CARBURETOR_BASES, COMPONENT_BASES, RENDER_METHODS, SYNCHRONOUS_CALLBACKS,
};
use crate::rules::support::chain::{assignment_root, chain_root, simple_target_root, ChainRoot};
use crate::rules::support::names::{extends_any, member_call_name, property_key_name};
use crate::Diagnostic;

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
    fn finish(self) -> Vec<Diagnostic>;

    /// `f(...)`, including every method call.
    fn call(&mut self, _call: &CallExpression<'a>, _context: &Context) {}

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

/// Drives a rule over one parsed file, maintaining the context it reads.
struct Walk<'a, R: Rule<'a>> {
    rule: R,
    context: Context,
    /// Spans of functions handed to a synchronous-callback method, which therefore run in place.
    synchronous: HashSet<Span>,
    /// Spans of functions that *are* a class member's body, which must not count as nesting.
    member_bodies: HashSet<Span>,
    marker: std::marker::PhantomData<&'a ()>,
}

impl<'a, R: Rule<'a>> Walk<'a, R> {
    /// Enters a function body: render code stops at a function boundary, unless the function is
    /// the member's own body or runs in place as a synchronous callback. Returns what to restore.
    fn enter_function(&mut self, span: Span) -> (bool, Span) {
        let was = (self.context.in_render, self.context.function);

        if !self.member_bodies.contains(&span) && !self.synchronous.contains(&span) {
            self.context.in_render = false;
        }

        self.context.function = span;

        was
    }
}

impl<'a, R: Rule<'a>> Visit<'a> for Walk<'a, R> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let outer_component = self.context.in_component;
        let outer_carburetor = self.context.in_carburetor;
        let outer_member = self.context.member.take();
        let outer_class = self.context.class_span;
        let outer_render = self.context.in_render;

        self.context.in_component = extends_any(class, &COMPONENT_BASES);
        self.context.in_carburetor = extends_any(class, &CARBURETOR_BASES);
        self.context.class_span = Some(class.span);
        // A class body is not render code until one of its render members is entered.
        self.context.in_render = false;

        self.rule.class(class, &self.context);

        walk::walk_class(self, class);

        self.context.in_component = outer_component;
        self.context.in_carburetor = outer_carburetor;
        self.context.member = outer_member;
        self.context.class_span = outer_class;
        self.context.in_render = outer_render;
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let outer_member = self.context.member.take();
        let outer_span = self.context.member_span;
        let outer_render = self.context.in_render;
        let name = property_key_name(&method.key).map(str::to_string);

        self.context.in_render = self.context.in_component
            && name.as_deref().is_some_and(|name| RENDER_METHODS.contains(&name));
        self.context.member = name;
        self.context.member_span = Some(method.span);

        self.rule.method(method, &self.context);
        self.member_bodies.insert(method.value.span);

        walk::walk_method_definition(self, method);

        self.context.member = outer_member;
        self.context.member_span = outer_span;
        self.context.in_render = outer_render;
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        let outer_member = self.context.member.take();
        let outer_span = self.context.member_span;
        let outer_render = self.context.in_render;
        let name = property_key_name(&property.key).map(str::to_string);

        // A lifecycle method written as a property is a hazard of its own, but its body is still
        // the render body as far as every other rule is concerned.
        self.context.in_render = self.context.in_component
            && name.as_deref().is_some_and(|name| RENDER_METHODS.contains(&name));
        self.context.member = name;
        self.context.member_span = Some(property.span);

        self.rule.property(property, &self.context);

        if let Some(value) = &property.value {
            self.member_bodies.insert(value.span());
        }

        walk::walk_property_definition(self, property);

        self.context.member = outer_member;
        self.context.member_span = outer_span;
        self.context.in_render = outer_render;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let (render, enclosing) = self.enter_function(function.span);

        walk::walk_function(self, function, flags);

        self.context.in_render = render;
        self.context.function = enclosing;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let (render, enclosing) = self.enter_function(arrow.span);

        walk::walk_arrow_function_expression(self, arrow);

        self.context.in_render = render;
        self.context.function = enclosing;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let method = member_call_name(&call.callee);
        let outer_update = self.context.in_update;
        let outer_draft = self.context.update_draft.take();

        // `update(draft => ...)` publishes when the callback returns, which several rules have to
        // know before they look at what the callback does.
        if method == Some("update") {
            self.context.in_update = true;
            self.context.update_draft = callback_parameter(call).map(str::to_string);
        } else {
            self.context.update_draft = outer_draft.clone();
        }

        self.rule.call(call, &self.context);

        // `items.push(v)` changes `items`, which no assignment appears anywhere for.
        if let Some(method) = method {
            if ARRAY_MUTATORS.contains(&method) {
                if let Expression::StaticMemberExpression(member) = &call.callee {
                    self.rule.mutation(&chain_root(&member.object), call.span, &self.context);
                }
            }
        }

        // A function argument of `map`, `filter` and the like runs while this expression
        // evaluates, so it inherits whatever the surrounding code is.
        if method.is_some_and(|name| SYNCHRONOUS_CALLBACKS.contains(&name)) {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    self.synchronous.insert(expression.span());
                }
            }
        }

        walk::walk_call_expression(self, call);

        self.context.in_update = outer_update;
        self.context.update_draft = outer_draft;
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        self.rule.identifier(identifier, &self.context);

        walk::walk_identifier_reference(self, identifier);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        self.rule.assignment(expression, &self.context);
        self.rule
            .mutation(&assignment_root(&expression.left), expression.span, &self.context);

        walk::walk_assignment_expression(self, expression);
    }

    fn visit_update_expression(&mut self, expression: &UpdateExpression<'a>) {
        self.rule.update(expression, &self.context);

        self.rule
            .mutation(&simple_target_root(&expression.argument), expression.span, &self.context);

        walk::walk_update_expression(self, expression);
    }

    fn visit_unary_expression(&mut self, expression: &UnaryExpression<'a>) {
        self.rule.unary(expression, &self.context);

        if expression.operator == UnaryOperator::Delete {
            self.rule
                .mutation(&chain_root(&expression.argument), expression.span, &self.context);
        }

        walk::walk_unary_expression(self, expression);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        self.rule.declarator(declarator, &self.context);

        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_member_expression(&mut self, expression: &MemberExpression<'a>) {
        self.rule.member(expression, &self.context);

        walk::walk_member_expression(self, expression);
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        self.rule.jsx_attribute(attribute, &self.context);

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

/// Runs one rule over one parsed file.
pub fn walk_rule<'a, R: Rule<'a>>(program: &Program<'a>, rule: R) -> Vec<Diagnostic> {
    let mut walk = Walk {
        rule,
        context: Context::top(program.span),
        synchronous: HashSet::new(),
        member_bodies: HashSet::new(),
        marker: std::marker::PhantomData,
    };

    walk.visit_program(program);

    walk.rule.finish()
}
