//! The one-pass analysis against the legacy two-pass oracle: identical answers on every corpus
//! source, for every class member both walk.

use super::corpus::CORPUS;
use super::legacy::{legacy_analyze_field, legacy_analyze_method};
use super::*;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Every class member the rules analyze, found anywhere in the file.
#[derive(Default)]
struct Members<'a> {
    methods: Vec<&'a MethodDefinition<'a>>,
    fields: Vec<&'a PropertyDefinition<'a>>,
}

impl<'a> Visit<'a> for Members<'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        match kind {
            AstKind::MethodDefinition(method)
                // Any member kind with a body: methods, constructors, getters and setters.
                if method.value.body.is_some() =>
            {
                self.methods.push(method);
            }
            AstKind::PropertyDefinition(field) => {
                if matches!(
                    &field.value,
                    Some(Expression::ArrowFunctionExpression(_))
                        | Some(Expression::FunctionExpression(_))
                ) {
                    self.fields.push(field);
                }
            }
            _ => {}
        }
    }
}

type CaptureDigest<'a> = (&'a str, bool, bool, bool);

/// One candidate flattened to everything its report depends on.
type CandidateDigest<'a> = (
    Span,
    bool,
    String,
    Option<&'a str>,
    bool,
    Vec<CaptureDigest<'a>>,
);

/// The member analysis as a comparable value.
fn digest<'a>(analysis: &MemberAnalysis<'a>) -> (bool, Vec<CandidateDigest<'a>>) {
    let closures = analysis
        .closures
        .iter()
        .map(|candidate| {
            let captures = candidate
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
                .collect();

            (
                candidate.span,
                candidate.class_dependency,
                match &candidate.usage {
                    Usage::DirectHelper(name) => format!("helper({name})"),
                    Usage::Callback => String::from("callback"),
                },
                candidate.forwarder.as_ref().map(|f| f.method),
                candidate.executes_in_render,
                captures,
            )
        })
        .collect();

    (analysis.class_dependency, closures)
}

#[test]
fn matches_legacy_on_corpus() {
    for (index, text) in CORPUS.iter().enumerate() {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "corpus[{index}] must parse: {:?}",
            parsed.diagnostics
        );

        let semantic = build_semantic(&parsed.program);
        let mut members = Members::default();

        members.visit_program(&parsed.program);

        for method in &members.methods {
            for render in [false, true] {
                let legacy = digest(&legacy_analyze_method(method, &semantic, render));
                let current = digest(&analyze_method(method, &semantic, render));

                assert_eq!(
                    legacy, current,
                    "corpus[{index}] method at {:?} diverges from the oracle (render: {render}): \
                     {text}",
                    method.span
                );
            }
        }

        for field in &members.fields {
            for render in [false, true] {
                let legacy = digest(&legacy_analyze_field(field, &semantic, render));
                let current = digest(&analyze_field(field, &semantic, render));

                assert_eq!(
                    legacy, current,
                    "corpus[{index}] field at {:?} diverges from the oracle (render: {render}): \
                     {text}",
                    field.span
                );
            }
        }
    }
}
