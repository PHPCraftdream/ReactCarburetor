//! H30: a closure or a member that uses nothing from the class it sits in.
//!
//! Every call of the member builds the closure again — every render, when the member is `render` —
//! and a function-valued field is rebuilt once per instance: allocations the module does not need,
//! because the code depends on nothing around it. Where `require-method-for-closure` reports the
//! closures the class could own, this rule reports the opposite corner — the code that does not
//! need the class at all and can be declared once at module level, where one copy serves every
//! instance and every call. See docs/hazards.md, H30.
//!
//! A member is only a candidate when nothing outside this analysis's reach calls it by name: React
//! calls the lifecycle hooks on the instance, the component base calls its own override points as
//! `this.<name>()`, and an `implements` clause may be a contract the crate cannot see. Those stay
//! where they are whatever their bodies use.

use std::collections::HashMap;

use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, Class, Comment, Declaration, ExportDefaultDeclarationKind,
    Expression, MethodDefinition, MethodDefinitionKind, Program, PropertyDefinition, PropertyKey,
    Statement,
};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, ScopeId, Scoping, Semantic};
use oxc_span::{GetSpan, Span};

use crate::fix::Fix;
use crate::rules::{locate, report, report_with_fix};
use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::chain::{chain_root, Base};
use crate::rules::support::closures::{
    analyze_field, analyze_method, build_semantic, is_component_class, Candidate, Capture,
    MemberAnalysis, Usage,
};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-module-function";

/// The members React itself calls on the instance by name, so a body that uses nothing from the
/// class is still not free to leave — the caller is React, not this file. `render` is covered by
/// `RENDER_METHODS`; these are the rest of the lifecycle and static hooks.
const REACT_CALLED_MEMBERS: [&str; 8] = [
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
    "getDerivedStateFromProps",
    "getDerivedStateFromError",
];

/// React's experimental lifecycle prefix — `UNSAFE_componentWillMount` and friends — treated the
/// same whatever the suffix says.
const UNSAFE_PREFIX: &str = "UNSAFE_";

/// `AntiHookComponent`'s own override-point surface: the base class calls these as `this.<name>()`
/// internally, so a member with one of these names is not free to leave either. A name list rather
/// than a semantic override check, because resolving it properly would mean following the imported
/// base class into its own file — the cross-file resolution this crate deliberately stays out of.
/// A test below pins every name against the base class's own source, so a rename there fails here
/// instead of going stale.
const BASE_SURFACE_MEMBERS: [&str; 15] = [
    "useEffects",
    "unUseEffects",
    "useEffect",
    "useCarburetor",
    "connect",
    "connectSelection",
    "useComputed",
    "useResource",
    "track",
    "loadStaleResources",
    "releaseEffects",
    "onCarburetorUpdate",
    "commitSubscriptions",
    "releaseSubscriptions",
    "releaseConnectionViews",
];

/// The name a class member is declared under, private names included — a `#helper` method is as
/// much a member as a public one, and D1 gives it no separate treatment.
fn member_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::PrivateIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

/// Whether something this analysis cannot see calls the member by name: React, the component base,
/// or an interface contract. Visibility is not the boundary — extractability is.
fn framework_called(name: &str) -> bool {
    RENDER_METHODS.contains(&name)
        || REACT_CALLED_MEMBERS.contains(&name)
        || BASE_SURFACE_MEMBERS.contains(&name)
        || name.starts_with(UNSAFE_PREFIX)
}

/// Whether the capture survives the extraction the rule asks for.
///
/// Same predicate `require-method-for-closure` applies, and the same reasoning: a this-derived
/// capture is re-read from `this`, so its usage does not matter — but a class-independent closure
/// cannot have one, since a this-derived capture is a class dependency by definition. Any other
/// capture has to be a never-written local, and even then only a directly-called helper can take
/// one: a callback's captures freeze at closure creation, where a module-level function's
/// parameters would not.
fn passable(capture: &Capture<'_>, usage: &Usage<'_>) -> bool {
    capture.this_derived || matches!(usage, Usage::DirectHelper(_)) && !capture.written_after_init
}

/// The message for one class-independent closure: what the allocation costs, and where to put it.
fn closure_message(candidate: &Candidate<'_>, member: Option<&str>) -> String {
    let cadence = if candidate.executes_in_render {
        String::from("on every render")
    } else {
        match member {
            Some(name) => format!("on every call of `{name}`"),
            None => String::from("on every call"),
        }
    };

    // A class-independent closure cannot be a pure forwarder — `() => this.m()` uses the class —
    // so there is no forwarder variant here to keep dead.
    debug_assert!(candidate.forwarder.is_none());

    let plain: Vec<&str> = candidate.captures.iter().map(|capture| capture.name).collect();

    if plain.is_empty() {
        return format!(
            "this closure uses nothing from the class and is rebuilt {cadence} — declare it once \
             at module level."
        );
    }

    let count = if plain.len() > 1 { "parameters" } else { "a parameter" };
    let quoted = plain.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", ");

    format!(
        "this closure uses nothing from the class and is rebuilt {cadence} — declare it once at \
         module level, taking {quoted} as {count}."
    )
}

/// The message for one class-independent member, by what it costs: a function-valued field is
/// rebuilt once per instance, a plain prototype method for nothing — but both sit in the class
/// without needing it.
fn member_message(field_function: bool) -> String {
    if field_function {
        String::from(
            "this member is allocated once per instance but uses nothing from the class — declare \
             it once at module level, where one copy serves every instance.",
        )
    } else {
        String::from(
            "this method allocates nothing per instance but uses nothing from the class either — \
             it does not depend on the instance and belongs at module level.",
        )
    }
}

/// The class statement a member would be extracted out of: the range the fix replaces, from the
/// statement's first token — its `export` keyword, a decorator, `abstract` — and its leading
/// comments through the class's last byte, so the function can go above all of it.
#[derive(Clone, Copy)]
struct StatementFix {
    start: u32,
    end: u32,
}

/// The top-level class statements a member can be extracted from, keyed by the class's span:
/// §7.3 allows the move only when the class stands directly in `Program.body`, or is the
/// declaration of an `export` / `export default`. A nested or expression-position class is not
/// in the map, which is what makes its members report without a fix.
fn top_level_class_statements(program: &Program<'_>) -> HashMap<Span, StatementFix> {
    let mut statements = HashMap::new();

    for statement in &program.body {
        let class = match statement {
            Statement::ClassDeclaration(class) => class,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::ClassDeclaration(class) => class,
                _ => continue,
            },
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class,
                _ => continue,
            },
            _ => continue,
        };

        let mut start = statement.span().start.min(class.span.start);

        // `class.span` need not reach back over the decorators, so take them by hand.
        for decorator in &class.decorators {
            start = start.min(decorator.span.start);
        }

        // The function goes above the class's own leading comments, so they are part of the
        // replaced range — and survive byte for byte inside it.
        if let Some((comments_start, _)) = leading_comments(program, program.source_text, start) {
            start = start.min(comments_start);
        }

        statements.insert(class.span, StatementFix { start, end: class.span.end });
    }

    statements
}

/// The start offset of the line `offset` sits on.
fn line_start(source: &str, offset: u32) -> u32 {
    let offset = (offset as usize).min(source.len());
    source[..offset].rfind('\n').map_or(0, |index| index as u32 + 1)
}

/// Whether a comment leads its own line: nothing but whitespace sits between the line's start
/// and the comment, so the whole line is the comment's to move.
fn leads_own_line(source: &str, comment: &Comment) -> bool {
    source[line_start(source, comment.span.start) as usize..comment.span.start as usize]
        .trim()
        .is_empty()
}

/// The leading-comment block above `offset`, as the byte range from the first comment's line
/// start to the last comment's last byte: line-leading comments ending on the line directly
/// above `offset` — a TSDoc above a member, a `//` note above a class — chained upward as far
/// as the block goes. A line-leading comment sharing `offset`'s own line, with only whitespace
/// between it and `offset`, counts too, so a note sitting beside the member's first line moves
/// with the extraction instead of dying with the member's line. `None` when there is none.
fn leading_comments(program: &Program<'_>, source: &str, offset: u32) -> Option<(u32, u32)> {
    let offset_line = locate(source, offset).0;

    let ends_above = |comment: &Comment| {
        let end_line = locate(source, comment.span.end).0;

        end_line + 1 == offset_line
            || (end_line == offset_line
                && comment.span.end <= offset
                && source[comment.span.end as usize..offset as usize].trim().is_empty())
    };

    let mut closest = program
        .comments
        .iter()
        .filter(|comment| leads_own_line(source, comment) && ends_above(comment))
        .map(|comment| comment.span)
        .min_by_key(|span: &Span| span.start)?;

    let mut line = locate(source, closest.start).0;

    while let Some(comment) = program
        .comments
        .iter()
        .find(|comment| {
            leads_own_line(source, comment) && locate(source, comment.span.end).0 + 1 == line
        })
    {
        line = locate(source, comment.span.start).0;
        closest = comment.span;
    }

    Some((line_start(source, closest.start), closest.end))
}

/// Every member-position occurrence of a member's name across the file. `this.<name>` and
/// `this.#<name>` inside the class being fixed — and nothing else — may be rewritten; every
/// other form (`other.name`, `obj["name"]`, `super.name`, `this.<name>` in another class of the
/// file, `ClassName.<name>` for a static) blocks the fix, because moving the member out only
/// stays safe while this file touches it exactly there.
struct ReferenceScan<'n> {
    name: &'n str,
    /// The class the member would leave; its `this` is the only `this` a hit may be rooted at.
    class_span: Span,
    /// Whether the class being walked is the one being fixed, innermost last.
    classes: Vec<bool>,
    /// Rewritable `this.<name>` / `this.#<name>` spans, with their nodes for scope lookup.
    allowed: Vec<(Span, NodeId)>,
    /// A reference form the rewrite cannot account for was seen.
    blocked: bool,
}

impl<'n> ReferenceScan<'n> {
    /// Records one member-position hit of the name: rewritable only when it is rooted at the
    /// fixed class's own `this` and no other class has been entered on the way down.
    fn hit(&mut self, span: Span, node: NodeId, rooted: bool) {
        if rooted && self.classes.last() == Some(&true) {
            self.allowed.push((span, node));
        } else {
            self.blocked = true;
        }
    }
}

impl<'a, 'n> Visit<'a> for ReferenceScan<'n> {
    fn visit_class(&mut self, class: &Class<'a>) {
        self.classes.push(class.span == self.class_span);

        walk::walk_class(self, class);

        self.classes.pop();
    }

    fn visit_expression(&mut self, expression: &Expression<'a>) {
        match expression {
            Expression::StaticMemberExpression(member) => {
                if member.property.name.as_str() == self.name {
                    // The same resolution `closures.rs` uses for this-chains: `this.a.<name>`
                    // is a hit on `a`, not on the member, and `super.<name>` is rooted at
                    // nothing the class owns.
                    let rooted = chain_root(expression).is_this_property(self.name);

                    self.hit(member.span, member.node_id(), rooted);
                }
            }
            Expression::PrivateFieldExpression(member) => {
                if member.field.name.as_str() == self.name {
                    let root = chain_root(&member.object);

                    // `this.a.#name` reads the private member off `a`, not off the instance.
                    let rooted = matches!(root.base, Base::This) && root.base_property.is_none();

                    self.hit(member.span, member.node_id(), rooted);
                }
            }
            Expression::ComputedMemberExpression(member) => {
                if let Expression::StringLiteral(literal) = &member.expression {
                    if literal.value.as_str() == self.name {
                        self.blocked = true;
                    }
                }
            }
            _ => {}
        }

        walk::walk_expression(self, expression);
    }
}

/// Scans the whole file for member-position hits of `name`.
fn scan_references<'n>(program: &Program<'_>, name: &'n str, class_span: Span) -> ReferenceScan<'n> {
    let mut scan = ReferenceScan {
        name,
        class_span,
        classes: Vec::new(),
        allowed: Vec::new(),
        blocked: false,
    };

    scan.visit_program(program);

    scan
}

/// Whether any scope from `scope` up to the module root binds `name` — what a bare `<name>` at
/// a rewritten reference site would resolve to once the member is a free function.
fn shadowed_at(scoping: &Scoping, scope: ScopeId, name: &str) -> bool {
    scoping.scope_ancestors(scope).any(|scope| {
        scoping.iter_bindings_in(scope).any(|symbol| scoping.symbol_name(symbol) == name)
    })
}

/// Whether a module-level binding — a top-level `const`/`let`/`var`/`function`/`class` or an
/// import — named `name` exists. The class's own name is one of these, so a member named after
/// its class stays unfixed too.
fn module_binding(scoping: &Scoping, name: &str) -> bool {
    scoping
        .iter_bindings_in(scoping.root_scope_id())
        .any(|symbol| scoping.symbol_name(symbol) == name)
}

/// The member a fix would move, in the two shapes §7.3 gives a module-level form: a method, and
/// a field whose value is an arrow. A field holding a `function` expression reports like an
/// arrow field but has no specified form to become, so it stays unfixed.
enum Extracted<'a> {
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

    /// The extracted function's text, before dedent: the member's declaration rebuilt at module
    /// level from source slices, so untouched formatting — comments in the body, exact spacing,
    /// destructuring — survives byte for byte. The same technique
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
                let type_parameters =
                    function.type_parameters.as_deref().map_or("", |t| slice(t.span));
                let parameters = slice(function.params.span);
                let return_type = function.return_type.as_deref().map_or("", |t| slice(t.span));
                let body = slice(
                    function.body.as_deref().expect("a reportable method has a body").span,
                );

                Some(format!(
                    "{async_prefix}function{generator_star} {name}{type_parameters}{parameters}\
                     {return_type} {body}"
                ))
            }
            Extracted::Field(_, arrow) => {
                let async_prefix = if arrow.r#async { "async " } else { "" };
                let type_parameters = arrow.type_parameters.as_deref().map_or("", |t| slice(t.span));
                let parameters = slice(arrow.params.span);
                let return_type = arrow.return_type.as_deref().map_or("", |t| slice(t.span));
                let body = match &arrow.body {
                    ArrowFunctionBody::FunctionBody(block) => slice(block.span),
                    expression => slice(expression.span()),
                };

                Some(format!(
                    "{async_prefix}const {name} = {type_parameters}{parameters}{return_type} => {body};"
                ))
            }
        }
    }
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

    let line_ending =
        if after.starts_with("\r\n") { 2 } else if after.starts_with('\n') { 1 } else { 0 };
    let rest = &after[line_ending..];
    let blank = rest.bytes().take_while(|byte| matches!(byte, b' ' | b'\t' | b'\r')).count();

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

    characters.all(|character| {
        character.is_ascii_alphanumeric() || character == '_' || character == '$'
    })
}

/// §7.3's one edit: the whole class statement replaced by the extracted function, a blank line,
/// and the class without the member, its `this.<name>` references rewritten to bare `<name>`.
/// Built from source slices, so the class keeps its own bytes — its comments, decorators and
/// remaining members come along untouched, and only the member's lines (plus the leading
/// comments that move with it, plus one blank line) leave the body. `None` leaves the report
/// standing without a fix, for any of §7.3's preconditions the member fails.
fn member_fix(
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

    if references.allowed.iter().any(|(_, node)| {
        shadowed_at(scoping, semantic.nodes().get_node(*node).scope_id(), name)
    }) {
        return None;
    }

    let member_span = extracted.span();
    let member_line_start = line_start(source, member_span.start);

    // The member's leading comments move ahead of the `function`/`const` keyword and are not
    // duplicated in the body they leave.
    let (block_start, comments_text) = leading_comments(program, source, member_span.start)
        .map_or((member_line_start, ""), |(start, end)| {
            (start.min(member_line_start), &source[start as usize..end as usize])
        });

    // The extracted text is dedented to column 0 from the class-body depth it was written at —
    // the member's own indentation is the depth to strip. A member whose line begins with
    // something else stays as it is; every line still parses.
    let own_indent = &source[member_line_start as usize..member_span.start as usize];
    let indent = if own_indent.trim().is_empty() { own_indent } else { "" };

    let mut block = String::new();

    if !comments_text.is_empty() {
        block.push_str(&dedent(comments_text, indent));
        block.push('\n');
    }

    block.push_str(&dedent(&extracted.function_text(name, source)?, indent));

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

/// What one class needed to know across the walk: whether it is a component by the same-file
/// heritage walk (D6), and whether it declares an interface this crate cannot check.
#[derive(Clone, Copy)]
struct ClassFacts {
    component: bool,
    implements: bool,
}

/// One pass over one file: which of its classes are components, and the reports the members and
/// closures of those classes earn.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    program: &'s Program<'a>,
    /// The class statements a member can be extracted out of, keyed by the class's span.
    statements: HashMap<Span, StatementFix>,
    /// The facts of each class in the file, keyed by the class's span — the only identity a class
    /// has across the walk's callbacks, and what keeps a nested class's answer from standing in
    /// for its enclosing one.
    classes: HashMap<Span, ClassFacts>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// The facts of the class the walk is in, when that class is one of this rule's own.
    fn facts(&self, context: &Context) -> Option<ClassFacts> {
        context
            .class_span
            .and_then(|span| self.classes.get(&span))
            .copied()
            .filter(|facts| facts.component)
    }

    /// Whether the member is `render`.
    fn is_render_key(key: &PropertyKey<'_>) -> bool {
        member_name(key).is_some_and(|name| RENDER_METHODS.contains(&name))
    }

    /// §7.3's fix for a reportable member, when every precondition it adds on top of the report
    /// holds: the class is a top-level statement, every reference to the member in the file has
    /// the `this.<name>` form the rewrite replaces, and no like-named binding — module-level, or
    /// visible at a rewritten call site — would capture the extracted name.
    fn fix_for(&self, context: &Context, extracted: Extracted<'_>, name: &str) -> Option<Fix> {
        let class_span = context.class_span?;
        let statement = *self.statements.get(&class_span)?;

        member_fix(
            self.program,
            self.source.text,
            self.semantic,
            statement,
            class_span,
            &extracted,
            name,
        )
    }

    /// Reports the member's closures that need nothing from the class — the mirror image of
    /// `require-method-for-closure`'s condition, which takes the class-dependent ones.
    fn report_closures(&mut self, analysis: MemberAnalysis<'_>, context: &Context) {
        for candidate in analysis.closures {
            if candidate.class_dependency {
                continue;
            }

            if candidate.captures.iter().any(|capture| !passable(capture, &candidate.usage)) {
                continue;
            }

            let message = closure_message(&candidate, context.member.as_deref());

            self.diagnostics.push(report(self.source, candidate.span.start, RULE, message));
        }
    }

    /// Reports the method itself, when its signature and body need nothing from the class and
    /// nothing outside this analysis's reach calls it by name.
    fn report_method(
        &mut self,
        method: &MethodDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
        context: &Context,
    ) {
        if facts.implements {
            return;
        }

        // The core candidate condition: the signature and body must need nothing from the class.
        if class_dependency {
            return;
        }

        // Getters, setters and the constructor are called for; an ordinary method without a body
        // is a declaration (abstract, `declare`, an overload signature), not code to move.
        if method.kind != MethodDefinitionKind::Method {
            return;
        }

        if method.value.body.is_none() {
            return;
        }

        if method.r#override || method.computed || !method.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&method.key) else { return };

        if framework_called(name) {
            return;
        }

        let message = member_message(false);
        let fix = self.fix_for(context, Extracted::Method(method), name);

        self.diagnostics.push(report_with_fix(self.source, method.span.start, RULE, message, fix));
    }

    /// The same for a class field, which is only a candidate when its value is a function.
    fn report_field(
        &mut self,
        property: &PropertyDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
        context: &Context,
    ) {
        if facts.implements {
            return;
        }

        if class_dependency {
            return;
        }

        let field_function = matches!(
            &property.value,
            Some(Expression::ArrowFunctionExpression(_)) | Some(Expression::FunctionExpression(_))
        );

        if !field_function {
            return;
        }

        if property.r#override || property.computed || !property.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&property.key) else { return };

        if framework_called(name) {
            return;
        }

        // A static field is built once per class rather than once per instance, so it takes the
        // plain prototype method's wording.
        let message = member_message(field_function && !property.r#static);
        let fix = match &property.value {
            Some(Expression::ArrowFunctionExpression(arrow)) => {
                self.fix_for(context, Extracted::Field(property, arrow), name)
            }
            _ => None,
        };

        self.diagnostics
            .push(report_with_fix(self.source, property.span.start, RULE, message, fix));
    }
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    /// `context.in_component` is direct-extends-only, but the allocation rules' scope is D6: a
    /// same-file subclass of a component counts, which only the semantic walk can see, so the
    /// answer is computed here and keyed by the class's span for the member callbacks to read.
    fn class(&mut self, class: &Class<'a>, _context: &Context) {
        let facts = ClassFacts {
            component: is_component_class(class, self.semantic),
            implements: !class.implements.is_empty(),
        };

        self.classes.insert(class.span, facts);
    }

    fn method(&mut self, method: &MethodDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else { return };

        // The walk's `in_render` needs a direct component base; a same-file subclass's render is
        // as much render code as the base's own, so the member name decides here as well.
        let member_is_render = context.in_render || Self::is_render_key(&method.key);

        let analysis = analyze_method(method, self.semantic, member_is_render);

        self.report_method(method, analysis.class_dependency, facts, context);
        self.report_closures(analysis, context);
    }

    fn property(&mut self, property: &PropertyDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else { return };

        let member_is_render = context.in_render || Self::is_render_key(&property.key);

        let analysis = analyze_field(property, self.semantic, member_is_render);

        self.report_field(property, analysis.class_dependency, facts, context);
        self.report_closures(analysis, context);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    walk_rule(
        program,
        Check {
            source,
            program,
            semantic: &semantic,
            classes: HashMap::new(),
            statements: top_level_class_statements(program),
            diagnostics: Vec::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::Path;

    use super::*;
    use crate::rules::support::testing::{diagnose, lines};
    use oxc_allocator::Allocator;
    use oxc_ast::AstKind;
    use oxc_ast::ast::ClassElement;
    use oxc_ast_visit::Visit;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn reported(source: &str) -> Vec<Diagnostic> {
        diagnose(source, check)
    }

    #[test]
    fn a_sort_comparator_in_render_is_reported_as_a_module_level_function() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return this.rows.sort((a, b) => a - b);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [4]);

        let message = &found[0].message;

        assert!(message.contains("uses nothing from the class"), "{message}");
        assert!(message.contains("rebuilt on every render"), "{message}");
        assert!(message.contains("declare it once at module level"), "{message}");
        assert!(!message.contains("taking"), "{message}");
    }

    #[test]
    fn a_direct_helper_over_a_never_written_local_takes_it_as_a_parameter() {
        let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const suffix = "!";

        const label = (name: string) => name + suffix;

        return label(this.title);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [6]);

        let message = &found[0].message;

        assert!(message.contains("rebuilt on every call of `method`"), "{message}");
        assert!(message.contains("taking `suffix` as a parameter"), "{message}");
    }

    #[test]
    fn a_callback_capturing_a_plain_local_is_not_reported() {
        // The local would freeze at closure creation, where a module-level function's parameter
        // would not — the same passability gate the method rule applies.
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        return <ul>{this.items.map((item) => <li key={item}>{suffix}</li>)}</ul>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_dependent_closure_is_the_other_rules_report_to_make() {
        let source = r#"
class Widget extends AntiHookComponent {
    method() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_private_method_that_uses_nothing_is_reported() {
        // D1: no visibility split — `#private` is eligible unconditionally, since nothing outside
        // the class can reference it by construction.
        let source = r#"
class Widget extends AntiHookComponent {
    #helper() {
        return compute();
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);

        let message = &found[0].message;

        assert!(message.contains("allocates nothing per instance"), "{message}");
        assert!(message.contains("belongs at module level"), "{message}");
    }

    #[test]
    fn a_public_method_that_uses_nothing_is_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    public format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [3]);
    }

    #[test]
    fn a_protected_method_that_uses_nothing_is_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    protected format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [3]);
    }

    #[test]
    fn lifecycle_names_are_never_reported_whatever_their_body_uses() {
        let source = r#"
class Widget extends AntiHookComponent {
    componentDidUpdate() {
        return Math.max(1, 2);
    }

    render() {
        return null;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn the_unsafe_prefix_is_a_lifecycle_name_whatever_the_suffix() {
        let source = r#"
class Widget extends AntiHookComponent {
    UNSAFE_componentWillMount() {
        return Math.max(1, 2);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn the_base_class_override_surface_is_never_reported_whatever_the_form() {
        // Methods and function-valued fields alike: the base calls these as `this.<name>()`, so
        // the declaration's shape does not matter.
        let source = r#"
class Widget extends AntiHookComponent {
    protected useEffects(): void {
        return;
    }

    protected track(source: number): number {
        return source;
    }

    protected useEffect = (callBack: string, name: string): void => {};

    protected onCarburetorUpdate = (): void => {};
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn every_base_surface_name_is_still_declared_on_antihookcomponent_itself() {
        let path = Path::new("../lib/src/Carburetor/Component/AntiHookComponent.tsx");
        let text = std::fs::read_to_string(path).expect(
            "the component base class source sits at lib/src/Carburetor/Component/\
             AntiHookComponent.tsx, relative to native/",
        );

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "the base class must parse: {:?}",
            parsed.diagnostics
        );

        // The base class is declared under `export`, so the classes are collected by node kind
        // rather than by statement shape.
        struct Classes<'a>(Vec<&'a Class<'a>>);

        impl<'a> Visit<'a> for Classes<'a> {
            fn enter_node(&mut self, kind: AstKind<'a>) {
                if let AstKind::Class(class) = kind {
                    self.0.push(class);
                }
            }
        }

        let mut classes = Classes(Vec::new());
        classes.visit_program(&parsed.program);

        let mut declared = HashSet::new();

        for class in classes.0 {
            for entry in &class.body.body {
                let name = match entry {
                    ClassElement::MethodDefinition(method) => member_name(&method.key),
                    ClassElement::PropertyDefinition(property) => member_name(&property.key),
                    _ => None,
                };

                if let Some(name) = name {
                    declared.insert(name.to_string());
                }
            }
        }

        for name in BASE_SURFACE_MEMBERS {
            assert!(
                declared.contains(name),
                "{name} is on the base-surface list but no longer declared on \
                 AntiHookComponent — update the list"
            );
        }
    }

    #[test]
    fn a_store_class_and_its_subclass_are_out_of_scope_entirely() {
        // D6 scope: store classes are never analysed by this rule, whatever a member's visibility
        // or its body's cleanliness.
        let source = r#"
class MyStore extends Carburetor {
    format(value: number): string {
        return value.toFixed(2);
    }

    protected helper(): number {
        return 1;
    }

    #privateHelper(): number {
        return 2;
    }
}

class SubStore extends MyStore {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn an_implements_clause_excludes_the_whole_class() {
        // The member may be satisfying the interface; without a type-checker the crate cannot
        // tell, so a report could break a real contract.
        let source = r#"
class Widget extends AntiHookComponent implements Formatter {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn an_override_member_is_never_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    override toString(): string {
        return "widget";
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_decorated_member_is_never_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    @bind
    handle(value: number): number {
        return value + 1;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_getter_and_the_constructor_are_never_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    constructor() {}

    get label(): string {
        return "widget";
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn an_overload_signature_is_skipped_but_the_implementation_still_reports() {
        let source = r#"
class Widget extends AntiHookComponent {
    helper(value: number): number;
    helper(value: unknown): unknown {
        return value;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [4]);
    }

    #[test]
    fn an_abstract_method_is_skipped_for_want_of_a_body() {
        let source = r#"
abstract class Ground extends AntiHookComponent {
    abstract helper(): void;
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_type_parameter_is_a_class_dependency() {
        // `T` names the class without naming it; a module-level function could not carry it. This
        // is the shared analysis's own signal — the test confirms it reaches this rule.
        let source = r#"
class Widget<T> extends AntiHookComponent {
    wrap(value: T): T[] {
        return [value];
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn this_in_a_static_member_still_means_the_class() {
        let source = r#"
class Widget extends AntiHookComponent {
    static make(): Widget {
        return new this();
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_this_return_type_is_a_class_dependency_without_a_value_level_this() {
        let source = r#"
class Widget extends AntiHookComponent {
    fluent(): this {
        return undefined as unknown as this;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn another_instances_private_field_is_still_a_class_dependency() {
        let source = r#"
class Widget extends AntiHookComponent {
    #value = 1;

    positive(other: Widget): boolean {
        return other.#value > 0;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_function_valued_field_is_reported_with_the_per_instance_wording() {
        let source = r#"
class Widget extends AntiHookComponent {
    format = (value: number): string => value.toFixed(2);
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);

        let message = &found[0].message;

        assert!(message.contains("allocated once per instance"), "{message}");
        assert!(message.contains("declare it once at module level"), "{message}");
        assert!(!message.contains("allocates nothing per instance"), "{message}");
    }

    #[test]
    fn a_static_function_field_takes_the_plain_wording() {
        // A static field is built once per class, not once per instance, so the per-instance
        // wording would be wrong; what it costs is nothing, and module level is still where it
        // belongs.
        let source = r#"
class Widget extends AntiHookComponent {
    static format = (value: number): string => value.toFixed(2);
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].message.contains("belongs at module level"), "{}", found[0].message);
    }

    #[test]
    fn closures_inside_an_arrow_field_are_not_collected_just_as_the_method_rule_does_not() {
        // The field itself is the report here; its inner closure stays uncollected, the same
        // boundary `require-method-for-closure` already works within.
        let source = r#"
class Widget extends AntiHookComponent {
    handler = () => {
        return [1].map((x) => x * 2);
    };
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
    }

    #[test]
    fn a_computed_member_name_is_never_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    ["helper"](): number {
        return 1;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_same_file_subclass_of_a_component_subclass_is_still_in_scope() {
        let source = r#"
class Ground extends AntiHookComponent {}

class Top extends Ground {
    helper(): number {
        return 1;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [5]);
    }

    #[test]
    fn a_subclass_of_an_imported_base_is_outside_the_same_file_walk() {
        // The documented limitation every rule in this crate shares.
        let source = r#"
import { External } from "./external";

class Widget extends External {
    helper(): number {
        return 1;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_closure_and_its_clean_member_both_report_in_one_pass() {
        let source = r#"
class Widget extends AntiHookComponent {
    helper() {
        return [1, 2].sort((a, b) => a - b);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [3, 4]);
    }

    // ---- §7.3: the autofix ----

    /// Runs the rule, applies the first diagnostic's fix (there is always exactly one violation
    /// in these fixtures), and re-runs the rule over the result — proving the fix is not just
    /// well-formed but actually resolves the violation it was attached to. The same pattern
    /// `no_lifecycle_class_property`'s tests use.
    fn fixed(source: &str) -> String {
        let diagnostics = diagnose(source, check);
        let fix = diagnostics[0].fix.as_ref().expect("a fix was expected");
        let text = crate::fix::apply(source, vec![fix]).expect("the fix changes the text");

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty(), "the fixed source must still parse: {text}");

        let remaining =
            check(&parsed.program, &Source { path: Path::new("fixture.tsx"), text: &text });
        assert!(remaining.is_empty(), "the fix must resolve the violation, left: {remaining:?}");

        text
    }

    /// Drives the real `--fix` loop over a source with more fixable candidates than one pass
    /// can land, proving the class-statement fixes overlap into one per pass and still
    /// converge.
    fn stabilized(source: &str) -> String {
        let (text, remaining) = crate::stabilize(source.to_string(), |text| {
            let allocator = Allocator::default();
            let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

            parsed
                .diagnostics
                .is_empty()
                .then(|| check(&parsed.program, &Source { path: Path::new("fixture.tsx"), text }))
        });

        assert!(remaining.is_empty(), "every candidate lands across passes, left: {remaining:?}");

        text
    }

    #[test]
    fn a_plain_method_moves_out_and_its_this_references_become_bare_calls() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return this.format(1);
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
function format(value: number): string {
    return value.toFixed(2);
}

class Widget extends AntiHookComponent {
    render() {
        return format(1);
    }
}
"#
        );
    }

    #[test]
    fn an_arrow_field_becomes_a_module_level_const() {
        let source = r#"
class Widget extends AntiHookComponent {
    bound = 1;

    make = (value: number): string => value.toFixed(2);

    render() {
        return this.make(1);
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
const make = (value: number): string => value.toFixed(2);

class Widget extends AntiHookComponent {
    bound = 1;

    render() {
        return make(1);
    }
}
"#
        );
    }

    #[test]
    fn an_async_method_keeps_its_async_keyword() {
        let source = r#"
class Widget extends AntiHookComponent {
    async load(url: string): Promise<string> {
        return url;
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
async function load(url: string): Promise<string> {
    return url;
}

class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn a_generic_method_keeps_its_type_parameters() {
        let source = r#"
class Widget extends AntiHookComponent {
    wrap<T>(value: T): T[] {
        return [value];
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
function wrap<T>(value: T): T[] {
    return [value];
}

class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn a_private_method_loses_its_hash_and_so_do_its_call_sites() {
        let source = r#"
class Widget extends AntiHookComponent {
    #format(value: number): string {
        return value.toFixed(2);
    }

    use(value: number): string {
        return this.#format(value);
    }
}
"#;

        // One pass cannot end clean here: extracting `#format` is what makes `use`
        // class-independent, so the fixed source earns a fresh report for `use` — the real
        // `--fix` loop takes it in the next pass, which is what `stabilized` drives.
        assert_eq!(
            stabilized(source),
            r#"
function format(value: number): string {
    return value.toFixed(2);
}

function use(value: number): string {
    return format(value);
}

class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn a_member_tsdoc_moves_along_with_the_extraction() {
        let source = r#"
class Widget extends AntiHookComponent {
    /**
     * Formats a value for display.
     */
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
/**
 * Formats a value for display.
 */
function format(value: number): string {
    return value.toFixed(2);
}

class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn the_function_goes_above_the_classs_own_leading_comment() {
        let source = r#"
/** A widget. */
class Widget extends AntiHookComponent {
    format(): string {
        return "w";
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
function format(): string {
    return "w";
}

/** A widget. */
class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn an_exported_class_keeps_its_export_keyword() {
        let source = r#"
export class Widget extends AntiHookComponent {
    format(): string {
        return "w";
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
function format(): string {
    return "w";
}

export class Widget extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn an_export_default_class_keeps_its_whole_statement() {
        let source = r#"
export default class extends AntiHookComponent {
    format(): string {
        return "w";
    }
}
"#;

        assert_eq!(
            fixed(source),
            r#"
function format(): string {
    return "w";
}

export default class extends AntiHookComponent {
}
"#
        );
    }

    #[test]
    fn a_function_expression_field_reports_without_a_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    make = function (value: number) {
        return value;
    };
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].fix.is_none(), "no module-level form is specified for it");
    }

    #[test]
    fn a_field_with_its_own_declared_type_reports_without_a_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    make: (value: number) => string = (value) => value.toFixed(2);
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].fix.is_none(), "the declared type has no place on the extraction");
    }

    #[test]
    fn a_nested_class_reports_without_a_fix() {
        let source = r#"
function wrapper() {
    return class Widget extends AntiHookComponent {
        helper(): number {
            return 1;
        }
    };
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [4]);
        assert!(found[0].fix.is_none(), "the class is not a top-level statement");
    }

    #[test]
    fn a_class_expression_reports_without_a_fix() {
        let source = r#"
const Widget = class extends AntiHookComponent {
    helper(): number {
        return 1;
    }
};
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].fix.is_none(), "the class is not a statement");
    }

    #[test]
    fn a_module_level_binding_of_the_same_name_blocks_the_fix() {
        let source = r#"
const format = String;

class Widget extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [5]);
        assert!(found[0].fix.is_none(), "the name is taken at module level");
    }

    #[test]
    fn a_shadowing_local_at_a_call_site_blocks_the_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        function format(value: number) {
            return value;
        }

        return this.format(1) + format(2);
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [11]);
        assert!(found[0].fix.is_none(), "the rewritten call would hit the local");
    }

    #[test]
    fn a_foreign_object_reference_blocks_the_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    run(other: Widget): string {
        return other.format(1) + this.label;
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [7]);
        assert!(found[0].fix.is_none(), "other.format is not this.format");
    }

    #[test]
    fn a_computed_string_key_reference_blocks_the_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    lookup(table: Record<string, number>): number {
        return table["format"] + this.label;
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [7]);
        assert!(found[0].fix.is_none(), "a computed key is not a form the rewrite replaces");
    }

    #[test]
    fn a_super_reference_blocks_the_fix() {
        let source = r#"
class Ground extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}

class Widget extends Ground {
    pick(): string {
        return super.format(1) + this.label;
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].fix.is_none(), "super.format keeps the member where it is");
    }

    #[test]
    fn a_this_reference_from_another_class_blocks_the_fix() {
        let source = r#"
class Other extends AntiHookComponent {
    pick(): string {
        return this.format(1) + this.label;
    }
}

class Widget extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [9]);
        assert!(found[0].fix.is_none(), "Other's this.format is another class's member");
    }

    #[test]
    fn a_class_name_reference_from_outside_blocks_the_fix() {
        let source = r#"
class Widget extends AntiHookComponent {
    static format(value: number): string {
        return value.toFixed(2);
    }
}

const behind = Widget.format(1);
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
        assert!(found[0].fix.is_none(), "Widget.format names the static from outside");
    }

    #[test]
    fn two_candidates_in_one_class_converge_across_passes() {
        // Both fixes replace the same class statement, so `apply` lands one per pass and
        // `stabilize` drives the second one home — the mechanism §7.3 leans on for any class
        // with more than one candidate.
        let source = r#"
class Widget extends AntiHookComponent {
    first(): number {
        return 1;
    }

    second(): number {
        return 2;
    }
}
"#;

        assert_eq!(
            stabilized(source),
            r#"
function first(): number {
    return 1;
}

function second(): number {
    return 2;
}

class Widget extends AntiHookComponent {
}
"#
        );
    }
}
