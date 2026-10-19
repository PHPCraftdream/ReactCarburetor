//! The one-analysis-per-member cache both allocation rules share.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use oxc_ast::ast::{MethodDefinition, PropertyDefinition};
use oxc_ast::AstKind;
use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};

use super::{analyze_field, analyze_method, MemberAnalysis};

/// The analyses of one file's members, built once and shared by both allocation rules.
///
/// The two rules ask the same question about the same member, so the second ask reuses the first
/// answer instead of walking the member again. The analyses only read the program's own data, so
/// they are rebuilt from the semantic model's long-lived nodes, never from the walk's short-lived
/// references.
pub struct MemberCache<'a> {
    /// Every class member by span, built from the semantic nodes on first use.
    members: RefCell<Option<HashMap<Span, AstKind<'a>>>>,
    entries: RefCell<HashMap<(Span, bool), Rc<MemberAnalysis<'a>>>>,
}

impl Default for MemberCache<'_> {
    fn default() -> Self {
        Self {
            members: RefCell::new(None),
            entries: RefCell::new(HashMap::new()),
        }
    }
}

impl<'a> MemberCache<'a> {
    /// The analysis of one method, built on first request and reused afterwards.
    pub fn method(
        &self,
        method: &MethodDefinition<'a>,
        semantic: &Semantic<'a>,
        member_is_render: bool,
    ) -> Rc<MemberAnalysis<'a>> {
        self.analysis(method.span, member_is_render, semantic, |node| match node {
            AstKind::MethodDefinition(node) => analyze_method(node, semantic, member_is_render),
            _ => unreachable!("a method's span indexes a method node"),
        })
    }

    /// The analysis of one class field, built on first request and reused afterwards.
    pub fn field(
        &self,
        field: &PropertyDefinition<'a>,
        semantic: &Semantic<'a>,
        member_is_render: bool,
    ) -> Rc<MemberAnalysis<'a>> {
        self.analysis(field.span, member_is_render, semantic, |node| match node {
            AstKind::PropertyDefinition(node) => analyze_field(node, semantic, member_is_render),
            _ => unreachable!("a field's span indexes a field node"),
        })
    }

    /// The cached analysis for the member, or a freshly built one.
    fn analysis(
        &self,
        span: Span,
        member_is_render: bool,
        semantic: &Semantic<'a>,
        build: impl FnOnce(AstKind<'a>) -> MemberAnalysis<'a>,
    ) -> Rc<MemberAnalysis<'a>> {
        let key = (span, member_is_render);

        if let Some(analysis) = self.entries.borrow().get(&key) {
            return Rc::clone(analysis);
        }

        let node = self.member(span, semantic);
        let analysis = Rc::new(build(node));
        self.entries.borrow_mut().insert(key, Rc::clone(&analysis));
        analysis
    }

    /// The semantic model's own node for the member, which carries the program's lifetime.
    fn member(&self, span: Span, semantic: &Semantic<'a>) -> AstKind<'a> {
        let mut members = self.members.borrow_mut();
        let members = members.get_or_insert_with(|| {
            semantic
                .nodes()
                .iter()
                .map(|node| (node.span(), node.kind()))
                .collect()
        });
        *members
            .get(&span)
            .unwrap_or_else(|| panic!("no member node for span {span:?}"))
    }
}
