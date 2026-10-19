// Legacy scan

use super::super::dependency::{
    class_type_parameters, forwarder, member_class_dependency, this_derived, written_after_init,
    CaptureCollector, DependencyScan,
};
use super::*;
use oxc_span::GetSpan;

/// What the legacy scan decided about one function site.
pub(super) struct LegacySiteFlags {
    /// The member is render code and this site runs while it renders.
    pub(super) executes_in_render: bool,
}

/// One level of function nesting during the legacy scan.
pub(super) struct LegacyFrame {
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
pub(super) struct LegacyScan<'a> {
    /// The member's own body, which is never a candidate of its own.
    pub(super) root_id: NodeId,
    /// The frames of function nesting, innermost last.
    pub(super) frames: Vec<LegacyFrame>,
    /// What the scan decided about each candidate site, keyed by the site's span.
    pub(super) sites: HashMap<Span, LegacySiteFlags>,
    /// Functions that are the direct callee of a call, which run where they are written.
    pub(super) iifes: HashSet<Span>,
    /// Functions assigned to `this.<x>` or `this.#x`, which are members in all but syntax.
    pub(super) this_assigned: HashSet<Span>,
    /// Functions handed to a component element as a prop, which stay the props' problem.
    pub(super) jsx_props: HashSet<Span>,
    /// Functions given to a call that inspects its callback body in place.
    pub(super) protected_callbacks: HashSet<Span>,
    /// Function arguments of a synchronous-callback receiver, which run while they evaluate.
    pub(super) synchronous: HashSet<Span>,
    /// The declarators in the member, for telling a helper call from a callback argument.
    pub(super) declarators: Vec<LegacyDeclarator<'a>>,
    /// The kinds of the variable declarations whose declarators are being walked, innermost last.
    pub(super) kinds: Vec<VariableDeclarationKind>,
    /// The tag name of the JSX element an attribute belongs to, when it is a plain name.
    pub(super) jsx_component: bool,
    /// Whether the node being walked executes while a component renders.
    pub(super) render_executes: bool,
}

/// A declarator in the member, and the binding it introduces.
pub(super) struct LegacyDeclarator<'a> {
    pub(super) kind: VariableDeclarationKind,
    pub(super) symbol: SymbolId,
    pub(super) name: &'a str,
    pub(super) init: Option<Span>,
}

impl LegacyScan<'_> {
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

        self.frames.push(LegacyFrame {
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
                LegacySiteFlags {
                    executes_in_render: self.render_executes,
                },
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

impl<'a> Visit<'a> for LegacyScan<'a> {
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
                    if let Some(span) = expression_function(expression) {
                        self.protected_callbacks.insert(span);
                    }
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
        if member_call_name(&call.callee).is_some_and(|name| SYNCHRONOUS_CALLBACKS.contains(&name))
        {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    if let Some(span) = expression_function(expression) {
                        self.synchronous.insert(span);
                    }
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
        let outer = self.jsx_component;

        self.jsx_component = match &element.name {
            JSXElementName::Identifier(identifier) => identifier
                .name
                .as_str()
                .chars()
                .next()
                .is_some_and(char::is_uppercase),
            JSXElementName::IdentifierReference(identifier) => identifier
                .name
                .as_str()
                .chars()
                .next()
                .is_some_and(char::is_uppercase),
            JSXElementName::MemberExpression(_) => true,
            _ => false,
        };

        walk::walk_jsx_opening_element(self, element);

        self.jsx_component = outer;
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        // A lowercase name is a DOM element, whose attribute update costs less than a subtree
        // render; only a component prop is worth protecting from the other direction.
        if self.jsx_component {
            if let Some(value) = &attribute.value {
                let mut functions = Vec::new();
                attribute_functions(value, &mut functions);
                for span in functions {
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
        let kind = self
            .kinds
            .last()
            .copied()
            .unwrap_or(VariableDeclarationKind::Var);

        if let Some(identifier) = declarator.id.get_binding_identifier() {
            if let Some(symbol) = identifier.symbol_id.get() {
                self.declarators.push(LegacyDeclarator {
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

// Legacy collect
enum LegacySite<'n, 'a> {
    /// `() => ...`, whose `this` is the enclosing function's.
    Arrow(&'n ArrowFunctionExpression<'a>),
    /// `function () {}`, which binds a `this` of its own.
    Expression(&'n Function<'a>),
}

impl<'n, 'a> LegacySite<'n, 'a> {
    fn span(&self) -> Span {
        match self {
            LegacySite::Arrow(arrow) => arrow.span,
            LegacySite::Expression(function) => function.span,
        }
    }

    /// Runs a visitor over the site's whole extent, nested functions included.
    fn walk_into<V: Visit<'a>>(&self, visitor: &mut V) {
        match self {
            LegacySite::Arrow(arrow) => visitor.visit_arrow_function_expression(arrow),
            LegacySite::Expression(function) => {
                visitor.visit_function(function, ScopeFlags::Function)
            }
        }
    }
}

/// Builds a candidate out of every function site the scan left standing.
pub(super) struct LegacyCollect<'a, 's> {
    /// The member's own body, which is never a candidate of its own.
    pub(super) root_id: NodeId,
    pub(super) sites: &'s HashMap<Span, LegacySiteFlags>,
    pub(super) declarators: &'s [LegacyDeclarator<'a>],
    pub(super) member_span: Span,
    pub(super) type_parameters: Vec<SymbolId>,
    pub(super) member_is_render: bool,
    pub(super) semantic: &'s Semantic<'s>,
    pub(super) closures: Vec<Candidate<'a>>,
}

impl<'a, 's> LegacyCollect<'a, 's> {
    /// Walks the member and returns the candidates, in source order.
    pub(super) fn collect(mut self, root: &Root<'a>) -> Vec<Candidate<'a>> {
        root.visit(&mut self);

        self.closures
    }

    fn collect_site(&mut self, site: &LegacySite<'_, 'a>) {
        let span = site.span();
        let Some(flags) = self.sites.get(&span) else {
            return;
        };

        let captures = self.captures(site);
        let class_dependency =
            self.depends_on_class(site) || captures.iter().any(|capture| capture.this_derived);

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
    fn captures(&self, site: &LegacySite<'_, 'a>) -> Vec<Capture<'a>> {
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
    fn depends_on_class(&self, site: &LegacySite<'_, 'a>) -> bool {
        let mut scan = DependencyScan {
            type_parameters: &self.type_parameters,
            scoping: self.semantic.scoping(),
            found: false,
        };

        site.walk_into(&mut scan);

        scan.found
    }

    /// Whether the closure is bound to a name that is only ever called.
    fn usage(&self, span: Span) -> Usage<'a> {
        let Some(declarator) = self
            .declarators
            .iter()
            .find(|declarator| declarator.init == Some(span))
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
        let called = self
            .semantic
            .scoping()
            .get_resolved_references(declarator.symbol)
            .all(|reference| {
                let reference_span = self.semantic.reference_span(reference);

                contains(self.member_span, reference_span)
                    && matches!(
                        self.semantic.nodes().parent_kind(reference.node_id()),
                        AstKind::CallExpression(call) if call.callee.span() == reference_span
                    )
            });

        if called {
            Usage::DirectHelper(declarator.name)
        } else {
            Usage::Callback
        }
    }

    /// The method the closure forwards to, when it forwards to exactly one.
    fn forwarder(&self, site: &LegacySite<'_, 'a>) -> Option<Forwarder<'a>> {
        let LegacySite::Arrow(arrow) = site else {
            return None;
        };

        forwarder(arrow, self.semantic.scoping())
    }
}

impl<'a, 's> Visit<'a> for LegacyCollect<'a, 's> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if function.node_id() != self.root_id && function.r#type == FunctionType::FunctionExpression
        {
            self.collect_site(&LegacySite::Expression(function));
        }

        walk::walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.collect_site(&LegacySite::Arrow(arrow));

        walk::walk_arrow_function_expression(self, arrow);
    }
}

/// The legacy two-pass analysis of one member, kept as the oracle the one-pass scan answers to.
fn legacy_analyze<'a>(
    root: Root<'a>,
    member_span: Span,
    member_id: NodeId,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    let mut scan = LegacyScan {
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
        closures: LegacyCollect {
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

/// The legacy analysis of one method.
pub(super) fn legacy_analyze_method<'a>(
    method: &'a MethodDefinition<'a>,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
    legacy_analyze(
        Root::Function(&method.value),
        method.span,
        method.node_id(),
        semantic,
        member_is_render,
    )
}

/// The legacy analysis of one class field.
pub(super) fn legacy_analyze_field<'a>(
    field: &'a PropertyDefinition<'a>,
    semantic: &Semantic<'_>,
    member_is_render: bool,
) -> MemberAnalysis<'a> {
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

    legacy_analyze(
        root,
        field.span,
        field.node_id(),
        semantic,
        member_is_render,
    )
}
