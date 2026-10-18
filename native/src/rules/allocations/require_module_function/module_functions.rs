//! H30's nested-function analysis: functions that use nothing around them.
//!
//! A function declared inside another function is rebuilt on every call of its enclosure, and a
//! function that reads nothing from it — only its own parameters and locals, module bindings,
//! imports and globals — does not need to sit there. Where the class analysis asks "does this
//! closure need its class", this pass asks the same of every function in the file: "does it need
//! the function it sits in. Class methods are roots too, so contained callbacks may be
//! independent of the method and class. The class-member pass still owns member roots, avoiding
//! duplicate reports.

use oxc_ast::AstKind;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, ReferenceFlags, Semantic};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::config::ModuleFunctionScope;

use super::RULE;
use crate::rules::report;
use crate::rules::support::closures::{arrow_has_class_dependency, has_class_dependency};
use crate::rules::support::bases::{EXCLUDED_CALLBACK_APIS, RENDER_TRACKED_APIS};
use crate::rules::support::names::{member_call_name, unwrap_expression};
use crate::{Diagnostic, Source};

/// Whether `inner` lies within `outer`, spans being the only identity nodes share here.
fn contains(outer: Span, inner: Span) -> bool {
    inner.start >= outer.start && inner.end <= outer.end
}

/// The name a call was made under, whether `computed(...)` or `store.update(...)` — the same
/// spelling the class analysis's scan matches the excluded APIs by.
fn callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => member_call_name(callee),
    }
}

/// Whether this function allocation is a callback represented by a hook call directly in a
/// component prop expression.
fn is_component_prop_callback(semantic: &Semantic<'_>, node_id: NodeId) -> bool {
    let nodes = semantic.nodes();
    if is_component_prop_expression(nodes, node_id) {
        return true;
    }
    let candidate = nodes.kind(node_id).span();
    let mut id = node_id;
    loop {
        id = nodes.parent_id(id);
        match nodes.kind(id) {
            AstKind::ParenthesizedExpression(_) | AstKind::TSAsExpression(_) | AstKind::TSSatisfiesExpression(_) | AstKind::TSTypeAssertion(_) | AstKind::TSNonNullExpression(_) | AstKind::TSInstantiationExpression(_) => continue,
            AstKind::CallExpression(call)
                if matches!(&call.callee, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "useMemo" | "useCallback"))
                    || matches!(&call.callee, Expression::StaticMemberExpression(member) if matches!(&member.object, Expression::Identifier(object) if object.name == "React") && matches!(member.property.name.as_str(), "useMemo" | "useCallback")) =>
            {
                let mut represented = Vec::new();
                crate::rules::support::walk::functions::fresh_call(call, &mut represented);
                let factory = call.arguments.first().and_then(|argument| argument.as_expression()).is_some_and(|argument| unwrap_expression(argument).span() == candidate);
                if !represented.contains(&candidate) && !(factory && !represented.is_empty()) { continue; }
                return is_component_prop_expression(nodes, id);
            }
            AstKind::Program(_) => return false,
            _ => continue,
        }
    }
}

fn is_component_prop_expression(nodes: &oxc_semantic::AstNodes<'_>, call_id: NodeId) -> bool {
    let mut id = call_id;
    loop {
        let child = id;
        id = nodes.parent_id(id);
        match nodes.kind(id) {
            AstKind::ParenthesizedExpression(_) | AstKind::TSAsExpression(_) | AstKind::TSSatisfiesExpression(_) | AstKind::TSTypeAssertion(_) | AstKind::TSNonNullExpression(_) | AstKind::TSInstantiationExpression(_) => continue,
            // Only the value-bearing branches of a conditional are transparent — the branches
            // `fresh_functions` walks; its `test` selects between them and hands over nothing.
            AstKind::ConditionalExpression(conditional) => {
                let child_span = nodes.kind(child).span();
                if contains(conditional.consequent.span(), child_span) || contains(conditional.alternate.span(), child_span) { continue; }
                return false;
            }
            // Both operands of a logical expression yield its value, so both stay transparent.
            AstKind::LogicalExpression(_) => continue,
            AstKind::JSXExpressionContainer(_) => {
                let attribute_id = nodes.parent_id(id);
                let AstKind::JSXAttribute(_) = nodes.kind(attribute_id) else { return false; };
                let opening_id = nodes.parent_id(attribute_id);
                let AstKind::JSXOpeningElement(opening) = nodes.kind(opening_id) else { return false; };
                return match &opening.name {
                    JSXElementName::Identifier(identifier) => identifier.name.chars().next().is_some_and(char::is_uppercase),
                    JSXElementName::IdentifierReference(identifier) => identifier.name.chars().next().is_some_and(char::is_uppercase),
                    JSXElementName::MemberExpression(_) => true,
                    _ => false,
                };
            }
            _ => return false,
        }
    }
}

/// Whether the function is a direct argument of a call whose body another rule inspects in
/// place. The callback itself stays put; functions nested inside it were visited on their own
/// and stay ordinary candidates.
fn is_protected_callback(semantic: &Semantic<'_>, node_id: NodeId, span: Span) -> bool {
    let AstKind::CallExpression(call) = semantic.nodes().parent_kind(node_id) else {
        return false;
    };

    callee_name(&call.callee).is_some_and(|name| {
        name != "update" && EXCLUDED_CALLBACK_APIS.contains(&name)
    })
        && call.arguments.iter().any(|argument| {
            argument.as_expression().is_some_and(|expression| contains(expression.span(), span))
        })
}

/// Whether the function is the callee of its own call, possibly behind the parentheses an IIFE
/// wears. An IIFE runs where it is written, and the module pattern wrapped around one is
/// deliberate; extracting it would unroll the enclosure.
fn is_iife_callee(semantic: &Semantic<'_>, node_id: NodeId, span: Span) -> bool {
    let nodes = semantic.nodes();
    let mut id = node_id;

    loop {
        match nodes.parent_kind(id) {
            AstKind::ParenthesizedExpression(_) => id = nodes.parent_id(id),
            AstKind::CallExpression(call) => return contains(call.callee.span(), span),
            _ => return false,
        }
    }
}

/// The binding the function is known under, when its position gives it one: a declaration's own
/// name, or the variable a function expression or arrow is assigned to. A recursion on that name
/// is not a capture — it travels with the function when it moves.
fn own_symbol(function: Option<&Function<'_>>, parent: AstKind<'_>) -> Option<oxc_semantic::SymbolId> {
    if let Some(function) = function {
        if let Some(id) = &function.id {
            return id.symbol_id.get();
        }
    }

    if let AstKind::VariableDeclarator(declarator) = parent {
        return declarator
            .id
            .get_binding_identifier()
            .and_then(|identifier| identifier.symbol_id.get());
    }

    None
}

/// Collects the resolved references of one function that bind to a declaration in an enclosing
/// function. Unresolved references are globals and imports — exactly what a module-level
/// function may keep reading — and a declaration inside the function travels with it.
struct CaptureProbe<'a, 'p> {
    scoping: &'a oxc_semantic::Scoping,
    site: Span,
    enclosing: &'p [Span],
    own_symbol: Option<oxc_semantic::SymbolId>,
    found: bool,
}

impl<'a, 'p> Visit<'a> for CaptureProbe<'a, 'p> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let is_runtime_reference = identifier.reference_id.get().is_some_and(|reference| {
            self.scoping.get_reference(reference).flags()
                .intersects(ReferenceFlags::Read | ReferenceFlags::Write)
        });

        if !is_runtime_reference {
            walk::walk_identifier_reference(self, identifier);

            return;
        }

        if let Some(symbol) = identifier
            .reference_id
            .get()
            .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
        {
            if Some(symbol) != self.own_symbol {
                let declaration = self.scoping.symbol_span(symbol);

                if !contains(self.site, declaration)
                    && self.enclosing.iter().any(|span| contains(*span, declaration))
                {
                    self.found = true;
                }
            }
        }

        walk::walk_identifier_reference(self, identifier);
    }
}

/// One walk over the whole program. A class member is a root rather than a nested-function
/// candidate, but functions below that root are checked like any other nested function.
struct ModuleScan<'a, 's> {
    semantic: &'s Semantic<'a>,
    /// Where a self-sufficient nested function was found, in visit order.
    found: Vec<(Span, bool)>,
    /// The spans of the enclosing functions, outermost first, including the one being visited.
    functions: Vec<Span>,
    /// Whether each frame binds a `this`/`super`/`arguments`/`new.target` from below. Arrows
    /// pass theirs through, so a mark climbs to and including the first non-arrow frame.
    dynamic: Vec<bool>,
    arrows: Vec<bool>,
    class_depth: usize,
    class_type_parameters: Vec<Vec<oxc_semantic::SymbolId>>,
    /// Whether findings are restricted to class bodies.
    class_only: bool,
}

impl<'a, 's> ModuleScan<'a, 's> {
    /// Marks the frame the occurrence binds to, and every arrow between it and here.
    fn mark_dynamic(&mut self) {
        for index in (0..self.dynamic.len()).rev() {
            self.dynamic[index] = true;

            if !self.arrows[index] {
                break;
            }
        }
    }

    /// Enters a function boundary of either shape.
    fn enter(&mut self, span: Span, is_arrow: bool) {
        self.functions.push(span);
        self.dynamic.push(false);
        self.arrows.push(is_arrow);
    }

    /// `scope=classes` is intentionally represented by the same walk and only changes candidate
    /// filtering, not traversal: nested functions still need their enclosing scopes visited.
    fn visit_classes(&mut self, program: &'a Program<'a>) {
        self.class_only = true;
        self.visit_program(program);
        self.class_only = false;
    }
}

impl<'a, 's> Visit<'a> for ModuleScan<'a, 's> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let type_parameters = class
            .type_parameters
            .as_ref()
            .map_or_else(Vec::new, |declaration| {
                declaration.params.iter().filter_map(|parameter| parameter.name.symbol_id.get()).collect()
            });
        self.class_depth += 1;
        self.class_type_parameters.push(type_parameters);
        walk::walk_class(self, class);
        self.class_type_parameters.pop();
        self.class_depth -= 1;
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        // A method is a root for its callbacks, not a reportable function candidate.
        walk::walk_method_definition(self, method);
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        walk::walk_property_definition(self, property);
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        // A signature without a body is a declaration (`declare`, an overload), not code to move.
        if function.body.is_none() {
            return;
        }

        self.enter(function.span, false);
        walk::walk_function(self, function, flags);

        let marked = self.dynamic.pop();
        self.arrows.pop();
        let enclosing = self.functions.clone();
        self.functions.pop();

        let class_dependency = has_class_dependency(function, self.semantic);
        let parent = self.semantic.nodes().parent_kind(function.node_id());
        let member_root = matches!(parent, AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_));
        let tracked = self.semantic.nodes().ancestor_kinds(function.node_id()).any(|kind| {
            matches!(kind, AstKind::CallExpression(call) if callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name)))
        });
        let clean = !member_root
            && !is_component_prop_callback(self.semantic, function.node_id())
            && !class_dependency
            && !tracked
            && marked != Some(true)
            && !self.functions.is_empty()
            && (!self.class_only || self.class_depth > 0)
            && !is_protected_callback(self.semantic, function.node_id(), function.span)
            && !is_iife_callee(self.semantic, function.node_id(), function.span);

        if clean {
            let own = own_symbol(Some(function), self.semantic.nodes().parent_kind(function.node_id()));
            let mut probe = CaptureProbe {
                scoping: self.semantic.scoping(),
                site: function.span,
                enclosing: &enclosing,
                own_symbol: own,
                found: false,
            };

            probe.visit_function(function, ScopeFlags::Function);

            if !probe.found {
                self.found.push((function.span, self.class_depth > 0));
            }
        }
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.enter(arrow.span, true);
        walk::walk_arrow_function_expression(self, arrow);

        let marked = self.dynamic.pop();
        self.arrows.pop();
        let enclosing = self.functions.clone();
        self.functions.pop();

        let class_dependency = arrow_has_class_dependency(arrow, self.semantic);
        let parent = self.semantic.nodes().parent_kind(arrow.node_id());
        let member_root = matches!(parent, AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_));
        let tracked = self.semantic.nodes().ancestor_kinds(arrow.node_id()).any(|kind| {
            matches!(kind, AstKind::CallExpression(call) if callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name)))
        });
        let clean = !member_root
            && !is_component_prop_callback(self.semantic, arrow.node_id())
            && !class_dependency
            && !tracked
            && marked != Some(true)
            && !self.functions.is_empty()
            && (!self.class_only || self.class_depth > 0)
            && !is_protected_callback(self.semantic, arrow.node_id(), arrow.span)
            && !is_iife_callee(self.semantic, arrow.node_id(), arrow.span);

        if clean {
            let own = own_symbol(None, self.semantic.nodes().parent_kind(arrow.node_id()));
            let mut probe = CaptureProbe {
                scoping: self.semantic.scoping(),
                site: arrow.span,
                enclosing: &enclosing,
                own_symbol: own,
                found: false,
            };

            probe.visit_arrow_function_expression(arrow);

            if !probe.found {
                self.found.push((arrow.span, self.class_depth > 0));
            }
        }
    }

    /// A `this` below binds to the nearest frame at or above here that is not an arrow.
    fn visit_this_expression(&mut self, _: &ThisExpression) {
        self.mark_dynamic();
    }

    /// `new.target` belongs to the nearest function and does not survive a move.
    fn visit_super(&mut self, expression: &Super) {
        self.mark_dynamic();
        walk::walk_super(self, expression);
    }

    fn visit_new_target(&mut self, _: &NewTarget) {
        self.mark_dynamic();
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name)) {
            self.mark_dynamic();
        }
        walk::walk_call_expression(self, call);
    }

    /// `this` does; in a function of its own it marks that one.
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let is_runtime_reference = identifier.reference_id.get().is_some_and(|reference| {
            self.semantic.scoping()
                .get_reference(reference)
                .flags()
                .intersects(ReferenceFlags::Read | ReferenceFlags::Write)
        });

        let is_implicit_arguments = identifier.name == "arguments"
            && identifier.reference_id.get().is_some_and(|reference| {
                let resolved = self.semantic.scoping().get_reference(reference);
                resolved.flags().intersects(ReferenceFlags::Read | ReferenceFlags::Write)
                    && resolved.symbol_id().is_none()
            });

        if is_runtime_reference
            && is_implicit_arguments
            && self.functions.iter().any(|span| contains(*span, identifier.span))
        {
            self.mark_dynamic();
        }

        walk::walk_identifier_reference(self, identifier);
    }
}

/// The message for one self-sufficient nested function: what the call costs, and where it goes.
fn module_message() -> String {
    String::from(
        "this nested function uses nothing from the function it sits in and is rebuilt on every \
         call — declare it once at module level.",
    )
}

/// Runs the module-scope half of the rule over one parsed file.
pub(super) fn check<'a>(
    program: &'a Program<'a>,
    semantic: &Semantic<'a>,
    source: &Source<'_>,
    scope: ModuleFunctionScope,
) -> Vec<Diagnostic> {
    let mut scan = ModuleScan {
        semantic,
        found: Vec::new(),
        functions: Vec::new(),
        dynamic: Vec::new(),
        arrows: Vec::new(),
        class_depth: 0,
        class_type_parameters: Vec::new(),
        class_only: false,
    };

    if scope == ModuleFunctionScope::All {
        scan.visit_program(program);
    } else {
        scan.visit_classes(program);
    }

    let mut diagnostics: Vec<Diagnostic> = scan
        .found
        .iter()
        .map(|(span, in_class)| {
            let mut diagnostic = report(source, span.start, RULE, module_message());
            diagnostic.scope = Some(String::from(if *in_class { "class" } else { "module" }));

            diagnostic
        })
        .collect();

    // Sites were collected innermost first on the way out of the walk; report in source order.
    diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    diagnostics
}
