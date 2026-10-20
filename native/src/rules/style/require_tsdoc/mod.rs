//! Requires a TSDoc block on functions, class methods, function-valued properties and exported
//! `const` functions, and pushes back when the summary is empty or runs past `maxLines`.
//!
//! "Terse" is not mechanically checkable, so the rule settles for its shape: a `/**` block
//! rather than a `//` note or a plain `/*` wrapper, a summary that says something, and at most a
//! few lines of it. Only the summary counts — the rationale after the first blank line is the
//! part this repository wants at length, so limiting it would be limiting explanation itself.
//! Overload signatures, pure `@inheritdoc` comments, private members under `access: "public"`,
//! and trivial accessors when `allowTrivialAccessors` is set, are excused. Each exemption
//! returns before any of the checks below, so an excused node also escapes the parameter and
//! field checks.
//!
//! `requireParamDocs` asks every parameter of a covered function to carry its own `@param` tag
//! with a description that says something; `requireFieldDocs` asks a plain class field for the
//! same doc a function gets. A parameter written without a name — a destructured pattern — has
//! nothing a tag can be matched against and is skipped.
//!
//! A constructor parameter property — `constructor(protected data: T)` — declares its field
//! inside the parameter list, where no second comment position exists, so its documentation
//! cannot be split in two. The constructor's own `@param data` tag counts as the field's doc
//! too, and `requireFieldDocs` does not apply to it: one declaration, one doc, at the only
//! place a reader could look for it.
//!
//! A function with exactly one parameter is excused from the tag requirement, because
//! `@param value - the value` restates the signature. It excuses a missing tag, not a broken
//! one — a `@param` that is present must still carry a description.

use oxc_ast::ast::{
    BindingPattern, Class, Declaration, ExportDefaultDeclarationKind, FormalParameters, Function,
    Program, Statement, TSAccessibility, VariableDeclarator,
};

use crate::config::RequireTsdocOptions;
use crate::rules::report;
use crate::rules::style::comment_before;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-tsdoc";

/// The summary paragraph of a TSDoc block: decorations stripped, cut at the first tag line and
/// at the blank line that ends the summary. Only the summary is measured, because the rationale
/// below it is the part this repository wants written at length.
fn summary_lines(raw: &str) -> Vec<&str> {
    let body = &raw[3..raw.len().saturating_sub(2).max(3)];
    let mut lines = Vec::new();

    for line in body.split('\n') {
        let text = strip_marker(line);

        if text.starts_with('@') {
            break;
        }

        if text.is_empty() {
            // A blank line before any text is just the opening `/**` on its own line.
            if !lines.is_empty() {
                break;
            }

            continue;
        }

        lines.push(text);
    }

    lines
}

/// One physical comment line with its leading `*` decoration and whitespace stripped, the same
/// single pass `line.trim().replace(/^\*+/, '').trim()` performs on the JavaScript side.
fn strip_marker(line: &str) -> &str {
    line.trim().trim_start_matches('*').trim()
}

/// A `@param` tag: its name plus its description, continuation lines joined.
struct ParamTag {
    name: String,
    description: String,
}

/// The `@param` tags of a TSDoc block; a prose line under a tag is its description running over.
fn param_tags(raw: &str) -> Vec<ParamTag> {
    let body = &raw[3..raw.len().saturating_sub(2).max(3)];
    let mut tags: Vec<ParamTag> = Vec::new();
    let mut open: Option<usize> = None;

    for line in body.split('\n') {
        let text = strip_marker(line);

        if text.starts_with('@') {
            open = parse_param_tag(text).map(|tag| {
                tags.push(tag);

                tags.len() - 1
            });

            continue;
        }

        // A prose line under a `@param` is that tag's description running over; any other tag
        // line closes it, which the branch above handles by reassigning `open`.
        if let Some(index) = open {
            if !text.is_empty() {
                tags[index].description.push(' ');
                tags[index].description.push_str(text);
            }
        }
    }

    tags
}

/// Reads `@param name - description` out of one tag line; `None` for every other tag.
fn parse_param_tag(text: &str) -> Option<ParamTag> {
    let rest = text.strip_prefix("@param")?;
    let mut parts = rest.trim_start().splitn(2, char::is_whitespace);

    let name = parts.next()?.trim();
    if name.is_empty() {
        return None;
    }

    // The leading `-` is decoration between the name and the description, not description.
    let description = parts
        .next()
        .map(str::trim)
        .map(|description| description.trim_start_matches('-').trim())
        .unwrap_or_default();

    Some(ParamTag {
        name: String::from(name),
        description: String::from(description),
    })
}

/// A parameter's written name, or `None` for a pattern a tag cannot be matched against.
fn parameter_name(pattern: &BindingPattern<'_>) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            Some(String::from(identifier.name.as_str()))
        }
        BindingPattern::AssignmentPattern(assignment) => parameter_name(&assignment.left),
        _ => None,
    }
}

/// The written names of one parameter list, rest parameters included.
fn parameter_names(parameters: &FormalParameters<'_>) -> Vec<Option<String>> {
    let mut names: Vec<Option<String>> = parameters
        .items
        .iter()
        .map(|item| parameter_name(&item.pattern))
        .collect();

    if let Some(rest) = &parameters.rest {
        names.push(parameter_name(&rest.rest.argument));
    }

    names
}

/// The written form of a member key: an identifier's name, or a literal exactly as written.
fn name_of_key(key: &oxc_ast::ast::PropertyKey<'_>) -> Option<String> {
    match key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(name) => Some(String::from(name.name.as_str())),
        oxc_ast::ast::PropertyKey::PrivateIdentifier(name) => {
            Some(String::from(name.name.as_str()))
        }
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(String::from(
            literal
                .raw
                .as_ref()
                .map_or(literal.value.as_str(), |raw| raw.as_str()),
        )),
        _ => None,
    }
}

/// Whether a member is hidden from outside the class, in the sense `access: "public"` excuses.
fn is_hidden(accessibility: Option<TSAccessibility>) -> bool {
    matches!(
        accessibility,
        Some(TSAccessibility::Private | TSAccessibility::Protected)
    )
}

struct Check<'s, 'a> {
    source: &'s Source<'s>,
    program: &'a Program<'a>,
    options: &'a RequireTsdocOptions,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// The exemptions are decided before the missing-doc checks: an overload has no comment to
    /// find, so it has to be excused before the rule would report one missing. The parameter
    /// and field checks after them only run past the exemptions too.
    #[allow(clippy::too_many_arguments)]
    fn check(
        &mut self,
        offset: u32,
        kind: &str,
        name: &str,
        overload: bool,
        accessibility: Option<TSAccessibility>,
        accessor: bool,
        parameters: &[Option<String>],
    ) {
        let text = self.source.text;
        let comment = comment_before(self.program, text, offset);
        let raw =
            comment.map(|comment| &text[comment.span.start as usize..comment.span.end as usize]);

        if let Some(raw) = raw {
            if self.options.allow_inheritdoc && raw.to_lowercase().contains("@inheritdoc") {
                return;
            }
        }

        if overload && self.options.allow_overloads {
            return;
        }

        if self.options.public_only && is_hidden(accessibility) {
            return;
        }

        if self.options.allow_trivial_accessors && accessor {
            return;
        }

        let Some(raw) = raw else {
            self.report(
                offset,
                format!("{kind} '{name}' is missing its TSDoc comment."),
            );

            return;
        };

        if comment.is_some_and(|comment| comment.is_line()) {
            self.report(
                offset,
                format!("{kind} '{name}' has a // comment where a /** */ TSDoc block is required."),
            );

            return;
        }

        if !raw.starts_with("/**") {
            self.report(
                offset,
                format!(
                    "{kind} '{name}' is documented with a plain /* */ block; TSDoc requires \
                     /** */."
                ),
            );

            return;
        }

        let lines = summary_lines(raw);

        if lines.is_empty() {
            self.report(offset, format!("The TSDoc on '{name}' has no description."));

            return;
        }

        let max = self.options.max_lines;

        if lines.len() > max as usize {
            self.report(
                offset,
                format!(
                    "The TSDoc summary on '{name}' is {} lines; the maximum is {max}. Keep the \
                     summary short and put the rest after a blank line.",
                    lines.len()
                ),
            );
        }

        if self.options.require_param_docs {
            let tags = param_tags(raw);
            let tagged: Vec<&str> = tags.iter().map(|tag| tag.name.as_str()).collect();

            // The lone-parameter exemption: exactly one parameter, excused from needing a tag; a
            // broken tag that IS present is still reported below, so the exemption excuses
            // absence only.
            if parameters.len() != 1 {
                for parameter in parameters.iter().flatten() {
                    if !tagged.contains(&parameter.as_str()) {
                        self.report(
                            offset,
                            format!(
                                "The TSDoc on '{name}' is missing a @param tag for '{parameter}'."
                            ),
                        );
                    }
                }
            }

            for tag in &tags {
                if tag.description.trim().is_empty() {
                    self.report(
                        offset,
                        format!(
                            "The @param tag for '{}' on '{name}' has no description.",
                            tag.name
                        ),
                    );
                }
            }
        }
    }

    fn report(&mut self, offset: u32, message: String) {
        self.diagnostics
            .push(report(self.source, offset, RULE, message));
    }

    fn check_function(&mut self, function: &Function<'_>, offset: u32) {
        let name = function
            .id
            .as_ref()
            .map_or("function", |id| id.name.as_str());

        self.check(
            offset,
            "Function",
            name,
            function.body.is_none(),
            None,
            false,
            &parameter_names(&function.params),
        );
    }

    fn check_class(&mut self, class: &Class<'_>) {
        for element in &class.body.body {
            match element {
                oxc_ast::ast::ClassElement::MethodDefinition(method) => {
                    let offset = method.span.start;

                    // An overload member has no body; a `get`/`set` is a trivial accessor.
                    self.check(
                        offset,
                        "Method",
                        name_of_key(&method.key)
                            .unwrap_or_else(|| String::from("method"))
                            .as_str(),
                        method.value.body.is_none(),
                        method.accessibility,
                        matches!(
                            method.kind,
                            oxc_ast::ast::MethodDefinitionKind::Get
                                | oxc_ast::ast::MethodDefinitionKind::Set
                        ),
                        &parameter_names(&method.value.params),
                    );
                }
                oxc_ast::ast::ClassElement::PropertyDefinition(property) => {
                    let name =
                        name_of_key(&property.key).unwrap_or_else(|| String::from("property"));
                    let holds_function = matches!(
                        property.value.as_ref(),
                        Some(
                            oxc_ast::ast::Expression::ArrowFunctionExpression(_)
                                | oxc_ast::ast::Expression::FunctionExpression(_)
                        )
                    );
                    let offset = property.span.start;

                    // A plain field has no body, yet is not an overload — hence the explicit
                    // flag; `requireFieldDocs` asks it for the doc a function gets.
                    if !holds_function {
                        if self.options.require_field_docs {
                            self.check(
                                offset,
                                "Class property",
                                &name,
                                false,
                                property.accessibility,
                                false,
                                &[],
                            );
                        }

                        continue;
                    }

                    let parameters = match property.value.as_ref().expect("checked above") {
                        oxc_ast::ast::Expression::ArrowFunctionExpression(arrow) => {
                            parameter_names(&arrow.params)
                        }
                        oxc_ast::ast::Expression::FunctionExpression(function) => {
                            parameter_names(&function.params)
                        }
                        _ => Vec::new(),
                    };

                    self.check(
                        offset,
                        "Class property",
                        &name,
                        false,
                        property.accessibility,
                        false,
                        &parameters,
                    );
                }
                _ => {}
            }
        }
    }

    /// The declarator of an exported `const` whose initializer is a function, if any.
    fn exported_function(declaration: &'a Declaration<'a>) -> Option<&'a VariableDeclarator<'a>> {
        let Declaration::VariableDeclaration(variable) = declaration else {
            return None;
        };

        variable.declarations.iter().find(|declarator| {
            matches!(declarator.id, BindingPattern::BindingIdentifier(_))
                && matches!(
                    declarator.init.as_ref(),
                    Some(
                        oxc_ast::ast::Expression::ArrowFunctionExpression(_)
                            | oxc_ast::ast::Expression::FunctionExpression(_)
                    )
                )
        })
    }

    fn visit_statement(&mut self, statement: &'a Statement<'a>, exported: Option<u32>) {
        match statement {
            Statement::FunctionDeclaration(function) => {
                self.check_function(function, exported.unwrap_or(function.span.start));
            }
            Statement::ClassDeclaration(class) => self.check_class(class),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    self.check_function(function, export.span.start);
                }
                Declaration::ClassDeclaration(class) => self.check_class(class),
                Declaration::VariableDeclaration(_) => {
                    if let Some(declarator) = Self::exported_function(&export.declaration) {
                        self.check_exported_function(declarator, export.span.start);
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    self.check_function(function, export.span.start);
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) => self.check_class(class),
                _ => {}
            },
            _ => {}
        }
    }

    fn check_exported_function(&mut self, declarator: &VariableDeclarator<'a>, offset: u32) {
        let name = match &declarator.id {
            BindingPattern::BindingIdentifier(identifier) => identifier.name.as_str(),
            _ => "function",
        };
        let parameters = match declarator.init.as_ref().expect("checked by the caller") {
            oxc_ast::ast::Expression::ArrowFunctionExpression(arrow) => {
                parameter_names(&arrow.params)
            }
            oxc_ast::ast::Expression::FunctionExpression(function) => {
                parameter_names(&function.params)
            }
            _ => Vec::new(),
        };

        self.check(
            offset,
            "Exported function",
            name,
            false,
            None,
            false,
            &parameters,
        );
    }
}

/// Runs the rule over one parsed file at the default options.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    check_with_options(program, source, &RequireTsdocOptions::default())
}

/// Runs the rule at explicit options; the config supplies the defaults or its overrides.
pub(in crate::rules) fn check_with_options(
    program: &Program<'_>,
    source: &Source,
    options: &RequireTsdocOptions,
) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        program,
        options,
        diagnostics: Vec::new(),
    };

    for statement in &program.body {
        check.visit_statement(statement, None);
    }

    check.diagnostics
}

#[cfg(test)]
mod tests;
