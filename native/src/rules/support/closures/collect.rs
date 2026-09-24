use super::dependency::{
    forwarder, this_derived, written_after_init, CaptureCollector, DependencyScan,
};
use super::*;
use oxc_span::GetSpan;

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
pub(super) struct Collect<'a, 's> {
    /// The member's own body, which is never a candidate of its own.
    pub(super) root_id: NodeId,
    pub(super) sites: &'s HashMap<Span, SiteFlags>,
    pub(super) declarators: &'s [Declarator<'a>],
    pub(super) member_span: Span,
    pub(super) type_parameters: Vec<SymbolId>,
    pub(super) member_is_render: bool,
    pub(super) semantic: &'s Semantic<'s>,
    pub(super) closures: Vec<Candidate<'a>>,
}

impl<'a, 's> Collect<'a, 's> {
    /// Walks the member and returns the candidates, in source order.
    pub(super) fn collect(mut self, root: &Root<'a>) -> Vec<Candidate<'a>> {
        root.visit(&mut self);

        self.closures
    }

    fn collect_site(&mut self, site: &Site<'_, 'a>) {
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
    fn forwarder(&self, site: &Site<'_, 'a>) -> Option<Forwarder<'a>> {
        let Site::Arrow(arrow) = site else {
            return None;
        };

        forwarder(arrow, self.semantic.scoping())
    }
}

impl<'a, 's> Visit<'a> for Collect<'a, 's> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if function.node_id() != self.root_id && function.r#type == FunctionType::FunctionExpression
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
