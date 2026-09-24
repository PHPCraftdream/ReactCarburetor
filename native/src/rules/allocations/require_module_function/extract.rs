use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, Class, ClassElement, MethodDefinition,
    MethodDefinitionKind, Program, PropertyDefinition, PropertyKey,
};
use oxc_ast_visit::Visit;
use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};

use crate::fix::Fix;

use super::references::{module_binding, scan_references, shadowed_at};
use super::statement::{leading_comments, line_start, StatementFix};
use super::support::member_name;

/// The member a fix would move, in the two shapes §7.3 gives a module-level form: a method, and
/// a field whose value is an arrow. A field holding a `function` expression reports like an
/// arrow field but has no specified form to become, so it stays unfixed.
pub(super) enum Extracted<'a> {
    Method(&'a MethodDefinition<'a>),
    Field(&'a PropertyDefinition<'a>, &'a ArrowFunctionExpression<'a>),
}

impl<'a> Extracted<'a> {
    /// The member's own range: what the class body loses.
    fn span(&self) -> Span {
        match self {
            Extracted::Method(method) => method.span,
            Extracted::Field(property, _) => property.span,
        }
    }

    /// The extracted function's text: the member's declaration rebuilt at module level from
    /// source slices, preserving the body and signature bytes exactly. The same technique
    /// `no_lifecycle_class_property::fix_for` uses, one size larger. Accessibility, `static`,
    /// `readonly` and `override` have no module-level meaning and are dropped; `async`,
    /// generator stars, generics, the parameter list and the return type are carried verbatim.
    /// `None` when the member carries something the form cannot take: a `this` parameter on a
    /// method.
    fn function_text(&self, name: &str, source: &str) -> Option<String> {
        let slice = |span: Span| &source[span.start as usize..span.end as usize];

        match self {
            Extracted::Method(method) => {
                let function = &method.value;

                if function.this_param.is_some() {
                    return None;
                }

                let async_prefix = if function.r#async { "async " } else { "" };
                let generator_star = if function.generator { "*" } else { "" };
                let type_parameters = function
                    .type_parameters
                    .as_deref()
                    .map_or("", |t| slice(t.span));
                let parameters = slice(function.params.span);
                let return_type = function
                    .return_type
                    .as_deref()
                    .map_or("", |t| slice(t.span));
                let body = slice(
                    function
                        .body
                        .as_deref()
                        .expect("a reportable method has a body")
                        .span,
                );

                Some(format!(
                    "{async_prefix}function{generator_star} {name}{type_parameters}{parameters}\
                     {return_type} {body}"
                ))
            }
            Extracted::Field(_, arrow) => {
                let async_prefix = if arrow.r#async { "async " } else { "" };
                let type_parameters = arrow
                    .type_parameters
                    .as_deref()
                    .map_or("", |t| slice(t.span));
                let parameters = slice(arrow.params.span);
                let return_type = arrow.return_type.as_deref().map_or("", |t| slice(t.span));
                let body = match &arrow.body {
                    ArrowFunctionBody::FunctionBody(block) => slice(block.span),
                    expression => slice(expression.span()),
                };

                Some(format!(
                    "const {name} = {async_prefix}{type_parameters}{parameters}{return_type} => {body};"
                ))
            }
        }
    }
}

struct OverloadScan<'a> {
    class_span: Span,
    name: &'a str,
    has_signature: bool,
}

impl<'a> Visit<'a> for OverloadScan<'a> {
    fn visit_class(&mut self, class: &Class<'a>) {
        if class.span != self.class_span {
            return;
        }

        self.has_signature = class.body.body.iter().any(|element| {
            let ClassElement::MethodDefinition(method) = element else {
                return false;
            };
            method.kind == MethodDefinitionKind::Method
                && method.value.body.is_none()
                && member_name(&method.key) == Some(self.name)
        });
    }
}

pub(super) fn has_overload_signature(program: &Program<'_>, class_span: Span, name: &str) -> bool {
    let mut scan = OverloadScan {
        class_span,
        name,
        has_signature: false,
    };
    scan.visit_program(program);
    scan.has_signature
}

/// Strips `indent` from the front of every line that has it; a line shorter than `indent` has
/// nothing to keep and goes down to nothing.
fn dedent(text: &str, indent: &str) -> String {
    text.lines()
        .map(|line| {
            if let Some(stripped) = line.strip_prefix(indent) {
                stripped
            } else {
                line.trim_start()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The end of the class-body removal for a member ending at `member_end`: the member's line
/// ending goes with it, and one blank line immediately after goes too, so the body does not
/// gain a blank line where the member used to be.
fn removal_end(source: &str, class_end: u32, member_end: u32) -> u32 {
    let after = &source[member_end as usize..class_end as usize];

    let line_ending = if after.starts_with("\r\n") {
        2
    } else if after.starts_with('\n') {
        1
    } else {
        0
    };
    let rest = &after[line_ending..];
    let blank = rest
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\r'))
        .count();

    if rest[blank..].starts_with('\n') {
        member_end + (line_ending + blank + 1) as u32
    } else {
        member_end + line_ending as u32
    }
}

/// Pulls the removal's start back over a blank line when the member was the class body's last
/// entry — nothing but the closing brace follows it — which would otherwise leave that blank
/// line dangling above the brace.
fn removal_start(source: &str, class_end: u32, member_end: u32, member_start: u32) -> u32 {
    if member_start == 0 || source[member_end as usize..class_end as usize].trim() != "}" {
        return member_start;
    }

    let above = line_start(source, member_start - 1);
    let separates = &source[above as usize..member_start as usize];

    // A genuinely blank line above — a newline with only whitespace around it — not the
    // member's own first-line indentation when no line is above at all.
    if separates.contains('\n') && separates.trim().is_empty() {
        above
    } else {
        member_start
    }
}

/// Whether `name` could be a module-level binding at all: member keys allow spellings no
/// identifier would take (`"my-helper"`, a numeric key). A reserved word slips past this
/// check, and a fix built from one simply fails to parse — which `stabilize` discards, keeping
/// the last text that parsed.
fn is_identifier_name(name: &str) -> bool {
    let mut characters = name.chars();

    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' || first == '$' => {}
        _ => return false,
    }

    characters
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '$')
}

/// §7.3's one edit: the whole class statement replaced by the extracted function, a blank line,
/// and the class without the member, its `this.<name>` references rewritten to bare `<name>`.
/// Built from source slices, so the class keeps its own bytes — its comments, decorators and
/// remaining members come along untouched, and only the member's lines (plus the leading
/// comments that move with it, plus one blank line) leave the body. `None` leaves the report
/// standing without a fix, for any of §7.3's preconditions the member fails.
pub(super) fn member_fix(
    program: &Program<'_>,
    source: &str,
    semantic: &Semantic<'_>,
    statement: StatementFix,
    class_span: Span,
    extracted: &Extracted<'_>,
    name: &str,
) -> Option<Fix> {
    // The extracted declaration needs a name a function or a `const` can carry.
    if !is_identifier_name(name) {
        return None;
    }

    // Only ECMAScript private members prove that callers outside this file cannot use the API.
    let truly_private = match extracted {
        Extracted::Method(method) => matches!(method.key, PropertyKey::PrivateIdentifier(_)),
        Extracted::Field(property, _) => {
            matches!(property.key, PropertyKey::PrivateIdentifier(_))
        }
    };
    if !truly_private {
        return None;
    }

    if let Extracted::Method(_) = extracted {
        if has_overload_signature(program, class_span, name) {
            return None;
        }
    }

    // A field's own declared type, optionality or definiteness has no place on the form the
    // extraction produces.
    if let Extracted::Field(property, _) = extracted {
        if property.type_annotation.is_some() || property.optional || property.definite {
            return None;
        }
    }

    // Every reference to the member in this file must have the `this.<name>` form the rewrite
    // knows how to replace.
    let references = scan_references(program, name, class_span);

    if references.blocked {
        return None;
    }

    // The free function the member becomes must not collide: a like-named module binding makes
    // the declaration illegal, and a like-named binding visible at a rewritten call site would
    // capture the call.
    let scoping = semantic.scoping();

    if module_binding(scoping, name) {
        return None;
    }

    if references
        .allowed
        .iter()
        .any(|(_, node)| shadowed_at(scoping, semantic.nodes().get_node(*node).scope_id(), name))
    {
        return None;
    }

    let member_span = extracted.span();
    let member_line_start = line_start(source, member_span.start);

    // The member's leading comments move ahead of the `function`/`const` keyword and are not
    // duplicated in the body they leave.
    let (block_start, comments_text) = leading_comments(program, source, member_span.start).map_or(
        (member_line_start, ""),
        |(start, end)| {
            (
                start.min(member_line_start),
                &source[start as usize..end as usize],
            )
        },
    );

    // The declaration starts at column 0, while its source-backed signature and body retain
    // their exact bytes; the body may remain indented at its former class depth.
    let own_indent = &source[member_line_start as usize..member_span.start as usize];
    let indent = if own_indent.trim().is_empty() {
        own_indent
    } else {
        ""
    };

    let mut block = String::new();

    if !comments_text.is_empty() {
        block.push_str(&dedent(comments_text, indent));
        block.push('\n');
    }

    block.push_str(&extracted.function_text(name, source)?);

    // The class without the member: its lines go, one following blank line with them — or one
    // blank line above, when the member was the body's last entry — and every rewritten
    // reference is spliced in its place.
    let start = removal_start(source, statement.end, member_span.end, block_start);
    let end = removal_end(source, statement.end, member_span.end);

    let mut edits: Vec<(u32, u32, &str)> = vec![(start, end, "")];

    for (span, _) in &references.allowed {
        edits.push((span.start, span.end, name));
    }

    edits.sort_by_key(|(start, end, _)| (*start, *end));

    let mut class_text = String::new();
    let mut cursor = statement.start;

    for (start, end, text) in edits {
        if start < cursor {
            continue;
        }

        class_text.push_str(&source[cursor as usize..start as usize]);
        class_text.push_str(text);
        cursor = end;
    }

    class_text.push_str(&source[cursor as usize..statement.end as usize]);

    Some(Fix {
        start: statement.start,
        end: statement.end,
        text: format!("{block}\n\n{class_text}"),
    })
}
