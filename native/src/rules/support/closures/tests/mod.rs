use super::*;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Parses a TSX snippet and hands the program and its semantic model to `check`.
fn parse(text: &str, check: impl FnOnce(&Program<'_>, &Semantic<'_>)) {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );

    let semantic = build_semantic(&parsed.program);

    check(&parsed.program, &semantic);
}

/// The members of the snippet: the first method, the first field, and every class.
#[derive(Default)]
struct Members<'a> {
    method: Option<&'a MethodDefinition<'a>>,
    field: Option<&'a PropertyDefinition<'a>>,
    classes: Vec<&'a Class<'a>>,
}

impl<'a> Visit<'a> for Members<'a> {
    // The walk hands each node over as an `AstKind`, whose variant carries the node with the
    // program's own lifetime — which is the lifetime the member finders below have to return.
    fn enter_node(&mut self, kind: AstKind<'a>) {
        match kind {
            AstKind::Class(class) => self.classes.push(class),
            AstKind::MethodDefinition(method) if self.method.is_none() => {
                self.method = Some(method);
            }
            AstKind::PropertyDefinition(field) if self.field.is_none() => {
                self.field = Some(field);
            }
            _ => {}
        }
    }
}

fn members<'a>(program: &'a Program<'a>) -> Members<'a> {
    let mut members = Members::default();

    members.visit_program(program);

    members
}

fn first_method<'a>(program: &'a Program<'a>) -> &'a MethodDefinition<'a> {
    members(program)
        .method
        .expect("test source must contain a method")
}

fn first_field<'a>(program: &'a Program<'a>) -> &'a PropertyDefinition<'a> {
    members(program)
        .field
        .expect("test source must contain a field")
}

fn class_named<'a>(program: &'a Program<'a>, name: &str) -> &'a Class<'a> {
    let found = members(program)
        .classes
        .into_iter()
        .find(|class| class.id.as_ref().is_some_and(|id| id.name.as_str() == name));

    found.expect("test source must contain the class")
}

/// Analyzes the snippet's first method, in or out of render.
fn method_analysis(text: &str, render: bool, check: impl FnOnce(MemberAnalysis<'_>)) {
    parse(text, |program, semantic| {
        check(analyze_method(first_method(program), semantic, render));
    });
}

fn component_class(text: &str, name: &str, check: impl FnOnce(bool)) {
    parse(text, |program, semantic| {
        check(is_component_class(class_named(program, name), semantic));
    });
}

fn field_analysis(text: &str, render: bool, check: impl FnOnce(MemberAnalysis<'_>)) {
    parse(text, |program, semantic| {
        check(analyze_field(first_field(program), semantic, render));
    });
}

/// Each capture flattened to name, this-derived, written-by-closure, written-after-init, in
/// first-use order.
fn captures_digest<'a>(candidate: &'a Candidate<'a>) -> Vec<(&'a str, bool, bool, bool)> {
    candidate
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
        .collect()
}

mod captures;
mod classes;
mod closures;
