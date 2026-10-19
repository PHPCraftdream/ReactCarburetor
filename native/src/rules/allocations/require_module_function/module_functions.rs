//! H30's nested-function analysis: functions that use nothing around them.
//!
//! A function declared inside another function is rebuilt on every call of its enclosure, and a
//! function that reads nothing from it — only its own parameters and locals, module bindings,
//! imports and globals — does not need to sit there. Where the class analysis asks "does this
//! closure need its class", this pass asks the same of every function in the file: "does it need
//! the function it sits in. Class methods are roots too, so contained callbacks may be
//! independent of the method and class. The class-member pass still owns member roots, avoiding
//! duplicate reports.

use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, ReferenceFlags, ScopeId, Semantic, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::config::ModuleFunctionScope;

use super::RULE;
use crate::rules::report;
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
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_) => continue,
            AstKind::CallExpression(call)
                if matches!(&call.callee, Expression::Identifier(identifier) if
                        matches!(identifier.name.as_str(), "useMemo" | "useCallback"))
                    || matches!(&call.callee, Expression::StaticMemberExpression(member) if
                        matches!(&member.object, Expression::Identifier(object) if object.name == "React")
                            && matches!(member.property.name.as_str(), "useMemo" | "useCallback")) =>
            {
                let mut represented = Vec::new();
                crate::rules::support::walk::functions::fresh_call(call, &mut represented);
                let factory = call
                    .arguments
                    .first()
                    .and_then(|argument| argument.as_expression())
                    .is_some_and(|argument| unwrap_expression(argument).span() == candidate);
                if !represented.contains(&candidate) && !(factory && !represented.is_empty()) {
                    continue;
                }
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
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_) => continue,
            // Only the value-bearing branches of a conditional are transparent — the branches
            // `fresh_functions` walks; its `test` selects between them and hands over nothing.
            AstKind::ConditionalExpression(conditional) => {
                let child_span = nodes.kind(child).span();
                if contains(conditional.consequent.span(), child_span)
                    || contains(conditional.alternate.span(), child_span)
                {
                    continue;
                }
                return false;
            }
            // Both operands of a logical expression yield its value, so both stay transparent.
            AstKind::LogicalExpression(_) => continue,
            AstKind::JSXExpressionContainer(_) => {
                let attribute_id = nodes.parent_id(id);
                let AstKind::JSXAttribute(_) = nodes.kind(attribute_id) else {
                    return false;
                };
                let opening_id = nodes.parent_id(attribute_id);
                let AstKind::JSXOpeningElement(opening) = nodes.kind(opening_id) else {
                    return false;
                };
                return match &opening.name {
                    JSXElementName::Identifier(identifier) => identifier
                        .name
                        .chars()
                        .next()
                        .is_some_and(char::is_uppercase),
                    JSXElementName::IdentifierReference(identifier) => identifier
                        .name
                        .chars()
                        .next()
                        .is_some_and(char::is_uppercase),
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

    callee_name(&call.callee)
        .is_some_and(|name| name != "update" && EXCLUDED_CALLBACK_APIS.contains(&name))
        && call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| contains(expression.span(), span))
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
fn own_symbol(function: Option<&Function<'_>>, parent: AstKind<'_>) -> Option<SymbolId> {
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

/// One level of function nesting, carrying everything its exit decision needs.
struct Frame {
    /// Whether it is an arrow, whose `this` and marks climb to its enclosure.
    is_arrow: bool,
    /// The class depth on entry, which tells the function's own `this` apart from a nested
    /// class's.
    class_base: usize,
    /// Whether the function needs the class it sits in, by class-bound syntax under it.
    class_dep: bool,
    /// Whether the function sits inside a tracked-API call's arguments.
    tracked: bool,
    /// Whether `this`/`super`/`arguments`/`new.target` below belongs to this chain of arrows.
    marked: bool,
    /// The lowest functional depth any runtime reference resolves to, `usize::MAX` if none.
    min_decl: usize,
    /// The name the function is bound under, whose references are its recursion, not captures.
    own_symbol: Option<SymbolId>,
}

/// One walk over the whole program. A class member is a root rather than a nested-function
/// candidate, but functions below that root are checked like any other nested function.
struct ModuleScan<'a, 's> {
    semantic: &'s Semantic<'a>,
    /// Kept as a field so reference resolution can share the walk's `&mut` borrow.
    scoping: &'s oxc_semantic::Scoping,
    /// Where a self-sufficient nested function was found, in visit order.
    found: Vec<(Span, bool)>,
    /// The frames of function nesting, innermost last.
    frames: Vec<Frame>,
    /// How many tracked-API calls the current position sits inside the arguments of.
    tracked_depth: usize,
    /// The functional depth of each scope seen so far, computed once per scope.
    scope_depths: HashMap<ScopeId, usize>,
    class_depth: usize,
    class_type_parameters: Vec<Vec<SymbolId>>,
    /// Whether findings are restricted to class bodies.
    class_only: bool,
}

impl<'a, 's> ModuleScan<'a, 's> {
    /// Enters a function boundary of either shape.
    fn enter(&mut self, is_arrow: bool, own: Option<SymbolId>) {
        self.frames.push(Frame {
            is_arrow,
            class_base: self.class_depth,
            class_dep: false,
            tracked: self.tracked_depth > 0,
            marked: false,
            min_decl: usize::MAX,
            own_symbol: own,
        });
    }

    /// Closes the innermost frame, passing its facts up to the enclosure.
    fn exit_frame(&mut self) -> Frame {
        let frame = self.frames.pop().expect("function frame");
        if let Some(parent) = self.frames.last_mut() {
            // A nested class between the two already shows up as a different class base.
            if frame.class_base == parent.class_base {
                parent.class_dep |= frame.class_dep;
            }
            // Only an arrow passes its `this` upward, to and including the first non-arrow.
            if frame.is_arrow {
                parent.marked |= frame.marked;
            }
            parent.min_decl = parent.min_decl.min(frame.min_decl);
        }
        frame
    }

    /// Marks the innermost frame as needing its class, when the occurrence is not inside a
    /// nested class — the class depth on entry is what separates the two.
    fn mark_class_dep(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            if self.class_depth == frame.class_base {
                frame.class_dep = true;
            }
        }
    }

    /// The functional depth of a scope: how many function scopes lie strictly above it. Computed
    /// by a memoized climb to the root, so each scope is resolved once per file.
    fn function_depth(&mut self, scope: ScopeId) -> usize {
        if let Some(depth) = self.scope_depths.get(&scope) {
            return *depth;
        }
        let depth = match self.scoping.scope_parent_id(scope) {
            None => 0,
            Some(parent) => {
                let base = self.function_depth(parent);
                base + usize::from(
                    self.scoping
                        .scope_flags(scope)
                        .intersects(ScopeFlags::Function),
                )
            }
        };
        self.scope_depths.insert(scope, depth);
        depth
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
                declaration
                    .params
                    .iter()
                    .filter_map(|parameter| parameter.name.symbol_id.get())
                    .collect()
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

        let own = own_symbol(
            Some(function),
            self.semantic.nodes().parent_kind(function.node_id()),
        );
        self.enter(false, own);
        walk::walk_function(self, function, flags);
        let frame = self.exit_frame();

        let parent = self.semantic.nodes().parent_kind(function.node_id());
        let member_root = matches!(
            parent,
            AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_)
        );
        let clean = !member_root
            && !is_component_prop_callback(self.semantic, function.node_id())
            && !frame.class_dep
            && !frame.tracked
            && !frame.marked
            && !self.frames.is_empty()
            && (!self.class_only || self.class_depth > 0)
            && !is_protected_callback(self.semantic, function.node_id(), function.span)
            && !is_iife_callee(self.semantic, function.node_id(), function.span);

        // A capture is a declaration outside the site and inside one of the enclosing functions:
        // its scope's depth lands in `1..k`, where `k` is this frame's index plus one. Module
        // declarations give 0; anything under the function itself gives `k` or more.
        if clean && frame.min_decl != 0 && frame.min_decl < self.frames.len() + 1 {
            self.found.push((function.span, self.class_depth > 0));
        }
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let own = own_symbol(None, self.semantic.nodes().parent_kind(arrow.node_id()));
        self.enter(true, own);
        walk::walk_arrow_function_expression(self, arrow);
        let frame = self.exit_frame();

        let parent = self.semantic.nodes().parent_kind(arrow.node_id());
        let member_root = matches!(
            parent,
            AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_)
        );
        let clean = !member_root
            && !is_component_prop_callback(self.semantic, arrow.node_id())
            && !frame.class_dep
            && !frame.tracked
            && !frame.marked
            && !self.frames.is_empty()
            && (!self.class_only || self.class_depth > 0)
            && !is_protected_callback(self.semantic, arrow.node_id(), arrow.span)
            && !is_iife_callee(self.semantic, arrow.node_id(), arrow.span);

        if clean && frame.min_decl != 0 && frame.min_decl < self.frames.len() + 1 {
            self.found.push((arrow.span, self.class_depth > 0));
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
        let tracked =
            callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name));
        if tracked {
            self.mark_dynamic();
            self.tracked_depth += 1;
        }
        walk::walk_call_expression(self, call);
        if tracked {
            self.tracked_depth -= 1;
        }
    }

    /// Class-bound syntax ties the innermost function to the class, unless a nested class owns
    /// the occurrence.
    fn visit_private_field_expression(&mut self, expression: &PrivateFieldExpression<'a>) {
        self.mark_class_dep();
        walk::walk_private_field_expression(self, expression);
    }

    fn visit_private_in_expression(&mut self, expression: &PrivateInExpression<'a>) {
        self.mark_class_dep();
        walk::walk_private_in_expression(self, expression);
    }

    fn visit_ts_this_type(&mut self, expression: &TSThisType) {
        self.mark_class_dep();
        walk::walk_ts_this_type(self, expression);
    }

    fn visit_ts_type_name(&mut self, name: &TSTypeName<'a>) {
        if matches!(name, TSTypeName::ThisExpression(_)) {
            self.mark_class_dep();
        }
        walk::walk_ts_type_name(self, name);
    }

    /// A reference to the nearest class's own type parameter names the class itself.
    fn visit_ts_type_reference(&mut self, reference: &TSTypeReference<'a>) {
        if let TSTypeName::IdentifierReference(name) = &reference.type_name {
            let symbol = name
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id());
            let is_type_parameter = symbol.is_some_and(|symbol| {
                self.class_type_parameters
                    .last()
                    .is_some_and(|parameters| parameters.contains(&symbol))
            });
            if is_type_parameter {
                self.mark_class_dep();
            }
        }
        walk::walk_ts_type_reference(self, reference);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        #[cfg(test)]
        SCAN_VISITS.with(|count| count.set(count.get() + 1));

        let is_runtime_reference = identifier.reference_id.get().is_some_and(|reference| {
            self.scoping
                .get_reference(reference)
                .flags()
                .intersects(ReferenceFlags::Read | ReferenceFlags::Write)
        });

        let is_implicit_arguments = identifier.name == "arguments"
            && identifier.reference_id.get().is_some_and(|reference| {
                let resolved = self.scoping.get_reference(reference);
                resolved
                    .flags()
                    .intersects(ReferenceFlags::Read | ReferenceFlags::Write)
                    && resolved.symbol_id().is_none()
            });

        if is_runtime_reference && is_implicit_arguments && !self.frames.is_empty() {
            self.mark_dynamic();
        }

        // Every runtime reference tightens the lowest declaration the frame reaches; the
        // recursion on the function's own name travels with it and does not count.
        if is_runtime_reference {
            let symbol = identifier
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id());
            let own = self.frames.last().and_then(|frame| frame.own_symbol);
            if let Some(symbol) = symbol {
                if Some(symbol) != own {
                    let depth = self.function_depth(self.scoping.symbol_scope_id(symbol));
                    if let Some(frame) = self.frames.last_mut() {
                        frame.min_decl = frame.min_decl.min(depth);
                    }
                }
            }
        }

        walk::walk_identifier_reference(self, identifier);
    }
}

impl ModuleScan<'_, '_> {
    /// Marks the frame the occurrence binds to; the frame pass on exit climbs the arrow chain.
    fn mark_dynamic(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            frame.marked = true;
        }
    }
}

#[cfg(test)]
thread_local! {
    static SCAN_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
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
        scoping: semantic.scoping(),
        found: Vec::new(),
        frames: Vec::new(),
        tracked_depth: 0,
        scope_depths: HashMap::new(),
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

/// How many identifier references one scan visits, which is the linearity test's yardstick.
#[cfg(test)]
pub(in crate::rules) fn scan_reference_visits(text: &str) -> usize {
    SCAN_VISITS.with(|count| count.set(0));
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, text, oxc_span::SourceType::tsx()).parse();
    let semantic = crate::rules::support::closures::build_semantic(&parsed.program);
    let source = Source::new(std::path::Path::new("test.tsx"), text);
    let _ = check(
        &parsed.program,
        &semantic,
        &source,
        ModuleFunctionScope::All,
    );
    SCAN_VISITS.with(std::cell::Cell::get)
}
