use super::dependency::forwarder;
use super::*;
use oxc_span::GetSpan;

/// What the scan decided about one function site, captures and class ties included.
pub(super) struct SiteData<'a> {
    /// The member is render code and this site runs while it renders.
    pub(super) executes_in_render: bool,
    /// Every runtime reference in the site's whole extent, in first-use order.
    pub(super) entries: Vec<RefEntry<'a>>,
    /// Whether the site's extent touches the enclosing class.
    pub(super) class_dep: bool,
    /// The method an arrow site forwards to, when it forwards to exactly one.
    pub(super) forwarder: Option<Forwarder<'a>>,
}

/// One resolved reference a frame saw, as the capture pass records it.
#[derive(Clone, Copy)]
pub(super) struct RefEntry<'a> {
    pub(super) symbol: SymbolId,
    pub(super) name: &'a str,
    pub(super) written: bool,
}

/// One level of function nesting during the scan.
pub(super) struct Frame<'a> {
    /// The function's own span.
    #[allow(dead_code)]
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
    /// The references seen in this frame's own body and merged up from its children.
    entries: Vec<RefEntry<'a>>,
    /// Position of each symbol in `entries`, for deduplication.
    index: HashMap<SymbolId, usize>,
    /// Whether this frame's extent needs the class it was written in.
    class_dep: bool,
    /// The class-nesting depth this frame was entered at, which gates class-dependency.
    class_base: usize,
    /// The method an arrow frame forwards to, when it forwards to exactly one.
    forwarder: Option<Forwarder<'a>>,
}

/// One walk over a class member, recording which function sites are candidates and why.
pub(super) struct Scan<'a, 's> {
    /// The member's own body, which is never a candidate of its own.
    pub(super) root_id: NodeId,
    /// The frames of function nesting, innermost last.
    pub(super) frames: Vec<Frame<'a>>,
    /// What the scan decided about each candidate site, keyed by the site's span.
    pub(super) sites: HashMap<Span, SiteData<'a>>,
    /// The sites in source order, which is the order candidates are built in.
    pub(super) order: Vec<Span>,
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
    pub(super) declarators: Vec<Declarator<'a>>,
    /// The kinds of the variable declarations whose declarators are being walked, innermost last.
    pub(super) kinds: Vec<VariableDeclarationKind>,
    /// The tag name of the JSX element an attribute belongs to, when it is a plain name.
    pub(super) jsx_component: bool,
    /// Whether the node being walked executes while a component renders.
    pub(super) render_executes: bool,
    /// The class-nesting depth, which is positive inside a nested class expression or declaration.
    pub(super) class_depth: usize,
    /// The enclosing class's own type parameters, which name the class without naming it.
    pub(super) type_parameters: Vec<SymbolId>,
    /// The semantic model's scopes, for resolving references to captures.
    pub(super) scoping: &'s Scoping,
}

/// A declarator in the member, and the binding it introduces.
pub(super) struct Declarator<'a> {
    pub(super) kind: VariableDeclarationKind,
    pub(super) symbol: SymbolId,
    pub(super) name: &'a str,
    pub(super) init: Option<Span>,
}

impl<'a> Scan<'a, '_> {
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
    /// walked as the root, so it is never reported against itself, and nothing inside a nested
    /// class is one either.
    fn enter_function(
        &mut self,
        id: NodeId,
        span: Span,
        is_arrow: bool,
        arrow: Option<&ArrowFunctionExpression<'a>>,
    ) -> bool {
        let is_root = id == self.root_id;
        let enclosing_render = self.render_executes;
        // Render code stops at a function boundary, unless the function runs in place as a
        // synchronous callback of one that evaluates during the render.
        if !is_root && self.class_depth == 0 && !self.synchronous.contains(&span) {
            self.render_executes = false;
        }

        let site = !is_root && self.class_depth == 0 && !self.protected(span);
        // The forwarder check is a pure function of the arrow, so it is answered once here and
        // only reported if the site survives.
        let forwarder = arrow.and_then(|arrow| forwarder(arrow, self.scoping));

        self.frames.push(Frame {
            span,
            is_arrow,
            enclosing_render,
            render: self.render_executes,
            uses_this: false,
            uses_lexical: false,
            calls_tracked: false,
            entries: Vec::new(),
            index: HashMap::new(),
            class_dep: false,
            class_base: self.class_depth,
            forwarder,
        });

        if site {
            self.sites.insert(
                span,
                SiteData {
                    executes_in_render: self.render_executes,
                    entries: Vec::new(),
                    class_dep: false,
                    forwarder,
                },
            );
            self.order.push(span);
        }

        site
    }

    /// Leaves a function boundary: merges the frame's captures and class tie upward, then carries
    /// what it learned into the site's decision.
    fn leave_function(&mut self, span: Span, is_site: bool) {
        let Frame {
            is_arrow,
            enclosing_render,
            render,
            uses_this,
            uses_lexical,
            calls_tracked,
            entries,
            class_dep,
            class_base,
            forwarder,
            ..
        } = self.frames.pop().expect("a frame was pushed on entry");

        if is_site {
            self.render_executes = enclosing_render;
        }

        if let Some(parent) = self.frames.last_mut() {
            if class_base == parent.class_base {
                parent.class_dep |= class_dep;
            }

            for entry in &entries {
                match parent.index.get(&entry.symbol) {
                    Some(&index) => parent.entries[index].written |= entry.written,
                    None => {
                        parent.index.insert(entry.symbol, parent.entries.len());
                        parent.entries.push(*entry);
                    }
                }
            }
        }

        if !is_site {
            return;
        }

        // A closure that runs during render and touches tracked data has to stay in render: moving
        // it out would hide the access from the render rules and make the hook rule report a false
        // positive for the access it left behind.
        if calls_tracked && render {
            self.sites.remove(&span);

            return;
        }

        // A function expression binds its own `this`, so lifting one that uses it would change what
        // the body sees; neither `arguments` nor `new.target` survives a move at all.
        if uses_lexical || (uses_this && !is_arrow) {
            self.sites.remove(&span);

            return;
        }

        if let Some(data) = self.sites.get_mut(&span) {
            data.entries = entries;
            data.class_dep = class_dep;
            data.forwarder = forwarder;
        }
    }

    /// Marks the innermost frame as class-dependent, when the node sits at its own class depth.
    fn mark_class_dep(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            if self.class_depth == frame.class_base {
                frame.class_dep = true;
            }
        }
    }
}

impl<'a> Visit<'a> for Scan<'a, '_> {
    fn visit_class(&mut self, class: &Class<'a>) {
        self.class_depth += 1;

        walk::walk_class(self, class);

        self.class_depth -= 1;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let is_site = function.r#type == FunctionType::FunctionExpression
            && !function.generator
            && self.enter_function(function.node_id(), function.span, false, None);

        walk::walk_function(self, function, flags);

        self.leave_function(function.span, is_site);
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        // A member's own body is always a `Function`, so an arrow is never the root.
        let site = self.enter_function(arrow.node_id(), arrow.span, true, Some(arrow));

        walk::walk_arrow_function_expression(self, arrow);

        self.leave_function(arrow.span, site);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if identifier.name == "arguments" && self.class_depth == 0 {
            // Each function owns its own `arguments`, so only the innermost frame is affected.
            if let Some(frame) = self.frames.last_mut() {
                frame.uses_lexical = true;
            }
        }

        // Every runtime reference is a capture candidate of the innermost frame, wherever it sits.
        if let Some(reference_id) = identifier.reference_id.get() {
            let reference = self.scoping.get_reference(reference_id);
            let flags = reference.flags();

            if flags.intersects(ReferenceFlags::Read | ReferenceFlags::Write) {
                if let Some(symbol) = reference.symbol_id() {
                    let written = flags.contains(ReferenceFlags::Write);

                    if let Some(frame) = self.frames.last_mut() {
                        match frame.index.get(&symbol) {
                            Some(&index) => frame.entries[index].written |= written,
                            None => {
                                frame.index.insert(symbol, frame.entries.len());
                                frame.entries.push(RefEntry {
                                    symbol,
                                    name: identifier.name.as_str(),
                                    written,
                                });
                            }
                        }
                    }
                }
            }
        }

        walk::walk_identifier_reference(self, identifier);
    }

    fn visit_this_expression(&mut self, expression: &ThisExpression) {
        if self.class_depth == 0 {
            // An arrow's `this` is the enclosing function's, so every frame up to and including the
            // first dynamic one owns this occurrence.
            for frame in self.frames.iter_mut().rev() {
                frame.uses_this = true;

                if !frame.is_arrow {
                    break;
                }
            }

            self.mark_class_dep();
        }

        walk::walk_this_expression(self, expression);
    }

    fn visit_new_target(&mut self, expression: &NewTarget) {
        if self.class_depth == 0 {
            if let Some(frame) = self.frames.last_mut() {
                frame.uses_lexical = true;
            }
        }

        walk::walk_new_target(self, expression);
    }

    fn visit_super(&mut self, expression: &Super) {
        self.mark_class_dep();

        walk::walk_super(self, expression);
    }

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

    fn visit_ts_type_reference(&mut self, reference: &TSTypeReference<'a>) {
        if let TSTypeName::IdentifierReference(name) = &reference.type_name {
            let symbol = name
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id());
            if symbol.is_some_and(|symbol| self.type_parameters.contains(&symbol)) {
                self.mark_class_dep();
            }
        }

        walk::walk_ts_type_reference(self, reference);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if callee_name(&call.callee).is_some_and(|name| EXCLUDED_CALLBACK_APIS.contains(&name)) {
            for argument in &call.arguments {
                if let Some(expression) = argument.as_expression() {
                    if let Some(span) = expression_function(expression) {
                        if self.class_depth == 0 {
                            self.protected_callbacks.insert(span);
                        }
                    }
                }
            }
        }

        // An IIFE runs where it is written, so its body is not an allocation the render pays for.
        // The callee is almost always parenthesized (`(() => {})()`), so the site's own span —
        // what `enter_function` records it under — is the unwrapped expression's, not the callee's.
        if is_function_site(&call.callee) && self.class_depth == 0 {
            self.iifes.insert(unwrap_parens(&call.callee).span());
        }

        // A closure that runs during render and reads or writes tracked data belongs in render.
        if callee_name(&call.callee).is_some_and(|name| RENDER_TRACKED_APIS.contains(&name))
            && self.class_depth == 0
        {
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
                        if self.class_depth == 0 {
                            self.synchronous.insert(span);
                        }
                    }
                }
            }
        }

        walk::walk_call_expression(self, call);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        if is_this_target(&expression.left)
            && is_function_site(&expression.right)
            && self.class_depth == 0
        {
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
        if self.jsx_component && self.class_depth == 0 {
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
        if self.class_depth == 0 {
            let kind = self
                .kinds
                .last()
                .copied()
                .unwrap_or(VariableDeclarationKind::Var);

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
        }

        walk::walk_variable_declarator(self, declarator);
    }
}
