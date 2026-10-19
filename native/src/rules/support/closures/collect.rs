use super::dependency::{this_derived, written_after_init};
use super::*;
use oxc_span::GetSpan;

/// Builds a candidate out of every function site the scan left standing, without walking again.
pub(super) struct Collect<'a, 's> {
    /// What the scan decided about each candidate site, keyed by the site's span.
    pub(super) sites: &'s HashMap<Span, SiteData<'a>>,
    /// The sites in source order, which is the order candidates are built in.
    pub(super) order: &'s [Span],
    /// The declarators keyed by their initialiser's span, for telling a helper from a callback.
    pub(super) usage: &'s HashMap<Span, Declarator<'a>>,
    pub(super) member_span: Span,
    pub(super) member_is_render: bool,
    pub(super) semantic: &'s Semantic<'s>,
    pub(super) closures: Vec<Candidate<'a>>,
}

impl<'a, 's> Collect<'a, 's> {
    /// Builds the candidates, in source order.
    pub(super) fn collect(mut self) -> Vec<Candidate<'a>> {
        for &span in self.order {
            if let Some(data) = self.sites.get(&span) {
                self.collect_site(span, data);
            }
        }

        self.closures
    }

    fn collect_site(&mut self, span: Span, data: &SiteData<'a>) {
        let captures = self.captures(span, data);
        let class_dependency =
            data.class_dep || captures.iter().any(|capture| capture.this_derived);

        self.closures.push(Candidate {
            span,
            captures,
            class_dependency,
            usage: self.usage(span),
            forwarder: data.forwarder,
            executes_in_render: self.member_is_render && data.executes_in_render,
        });
    }

    /// What the closure reads out of the member it was written in, from the scan's own records.
    fn captures(&self, span: Span, data: &SiteData<'a>) -> Vec<Capture<'a>> {
        data.entries
            .iter()
            .filter_map(|entry| {
                let declaration = self.semantic.scoping().symbol_span(entry.symbol);

                // A binding the closure declares itself, or one from outside the member that it
                // merely passes through, is not a capture of the member.
                if contains(span, declaration) || !contains(self.member_span, declaration) {
                    return None;
                }

                let written_after_init =
                    written_after_init(entry.symbol, self.semantic, self.member_span);

                Some(Capture {
                    name: entry.name,
                    this_derived: this_derived(entry.symbol, self.semantic, written_after_init),
                    written_by_closure: entry.written,
                    written_after_init,
                })
            })
            .collect()
    }

    /// Whether the closure is bound to a name that is only ever called.
    fn usage(&self, span: Span) -> Usage<'a> {
        let Some(declarator) = self.usage.get(&span) else {
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
}
