//! Reports a blank line between a TSDoc block and the declaration it documents, and fixes it
//! away.
//!
//! The blank line makes the comment look like it belongs to whatever sits above it, while TSDoc
//! tooling binds the comment to the declaration below regardless — the gap only misleads
//! readers. The fix drops the empty lines and keeps the declaration's own indentation. The doc
//! of an exported declaration sits above `export`, so the gap to measure ends at the export
//! wrapper rather than at the declaration inside it.

use oxc_ast::ast::{
    Class, Declaration, ExportDefaultDeclarationKind, Expression, Function, MethodDefinition,
    Program, PropertyDefinition, Statement,
};
use oxc_ast_visit::{walk, Visit};

use crate::fix::Fix;
use crate::rules::report_with_fix;
use crate::rules::style::comment_before;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-blank-line-after-tsdoc";

/// Whether `gap` contains an empty line: a newline, only spaces and tabs, then another newline.
fn has_blank_line(gap: &str) -> bool {
    let bytes = gap.as_bytes();

    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            let mut cursor = index + 1;

            while cursor < bytes.len() && (bytes[cursor] == b' ' || bytes[cursor] == b'\t') {
                cursor += 1;
            }

            if cursor < bytes.len() && bytes[cursor] == b'\n' {
                return true;
            }
        }
    }

    false
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

/// Whether an initializer expression holds a function: an arrow or a function expression.
fn holds_function(expression: Option<&Expression<'_>>) -> bool {
    matches!(
        expression,
        Some(Expression::ArrowFunctionExpression(_)) | Some(Expression::FunctionExpression(_))
    )
}

/// Whether a class member's own start, counting decorators the member hangs on.
fn member_start(span_start: u32, decorators: &[oxc_ast::ast::Decorator<'_>]) -> u32 {
    decorators
        .iter()
        .map(|decorator| decorator.span.start)
        .fold(span_start, u32::min)
}

struct Check<'s, 'a> {
    source: &'s Source<'s>,
    program: &'a Program<'a>,
    diagnostics: Vec<Diagnostic>,
    /// The export wrapper's start while inside one — where an exported declaration's doc sits.
    exported: Option<u32>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// Reports when the last comment before the declaration is a TSDoc block split off by a
    /// blank line. `wrapper` is where the doc-bearing node starts: the export keyword for an
    /// exported declaration, the member (or its first decorator) inside a class.
    fn check(&mut self, wrapper: u32, kind: &str, name: Option<String>) {
        let text = self.source.text;
        let Some(comment) = comment_before(self.program, text, wrapper) else {
            return;
        };

        let raw = &text[comment.span.start as usize..comment.span.end as usize];

        if comment.is_line() || !raw.starts_with("/**") {
            return;
        }

        let start = comment.span.end;
        let end = wrapper;
        let gap = &text[start as usize..end as usize];

        if !has_blank_line(gap) {
            return;
        }

        // What follows the gap's last newline is the declaration's own indentation; keeping it
        // moves the declaration up under the comment instead of out of its column.
        let keep = &gap[gap.rfind('\n').map_or(0, |index| index + 1)..];
        let fix = Fix {
            start,
            end,
            text: format!("\n{keep}"),
        };

        self.diagnostics.push(report_with_fix(
            self.source,
            start,
            RULE,
            format!(
                "A blank line separates the TSDoc comment from '{}'.",
                name.unwrap_or_else(|| String::from(kind))
            ),
            Some(fix),
        ));
    }

    fn check_function(&mut self, function: &Function<'_>, wrapper: u32) {
        let name = function
            .id
            .as_ref()
            .map(|id| String::from(id.name.as_str()));

        self.check(wrapper, "function", name);
    }

    /// The declarator of an exported `const` whose initializer is a function, if any.
    fn exported_function<'d>(
        declaration: &'d Declaration<'a>,
    ) -> Option<&'d oxc_ast::ast::VariableDeclarator<'a>> {
        let Declaration::VariableDeclaration(variable) = declaration else {
            return None;
        };

        variable.declarations.iter().find(|declarator| {
            matches!(
                declarator.id,
                oxc_ast::ast::BindingPattern::BindingIdentifier(_)
            ) && holds_function(declarator.init.as_ref())
        })
    }
}

impl<'a> Visit<'a> for Check<'_, 'a> {
    /// Function declarations only — a `Function` node is also every function expression, which
    /// the rule does not cover on its own.
    fn visit_statement(&mut self, statement: &Statement<'a>) {
        if let Statement::FunctionDeclaration(function) = statement {
            self.check_function(function, function.span.start);
        }

        walk::walk_statement(self, statement);
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        let name = class.id.as_ref().map(|id| String::from(id.name.as_str()));

        self.check(self.exported.unwrap_or(class.span.start), "class", name);

        walk::walk_class(self, class);
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let start = member_start(method.span.start, &method.decorators);

        self.check(start, "method", name_of_key(&method.key));

        walk::walk_method_definition(self, method);
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        if holds_function(property.value.as_ref()) {
            let start = member_start(property.span.start, &property.decorators);

            self.check(start, "class property", name_of_key(&property.key));
        }

        walk::walk_property_definition(self, property);
    }

    /// `walk_export_declaration` descends into the declaration; the exported flag marks where
    /// the exported doc comments sit, and each covered declaration is checked here once.
    fn visit_export_declaration(&mut self, export: &oxc_ast::ast::ExportDeclaration<'a>) {
        let saved = self.exported.replace(export.span.start);

        if let Declaration::FunctionDeclaration(function) = &export.declaration {
            self.check_function(function, export.span.start);
        }

        if let Some(declarator) = Self::exported_function(&export.declaration) {
            self.check(
                export.span.start,
                "exported function",
                declarator_name(declarator),
            );
        }

        walk::walk_export_declaration(self, export);

        self.exported = saved;
    }

    fn visit_export_default_declaration(
        &mut self,
        export: &oxc_ast::ast::ExportDefaultDeclaration<'a>,
    ) {
        let saved = self.exported.replace(export.span.start);

        if let ExportDefaultDeclarationKind::FunctionDeclaration(function) = &export.declaration {
            self.check_function(function, export.span.start);
        }

        // The default walk descends into the declaration; a class is checked by `visit_class`
        // with the exported flag still set.
        walk::walk_export_default_declaration(self, export);

        self.exported = saved;
    }
}

/// The bound name of one exported declarator, when it spells a plain identifier.
fn declarator_name(declarator: &oxc_ast::ast::VariableDeclarator<'_>) -> Option<String> {
    match &declarator.id {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => {
            Some(String::from(identifier.name.as_str()))
        }
        _ => None,
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        program,
        diagnostics: Vec::new(),
        exported: None,
    };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests;
