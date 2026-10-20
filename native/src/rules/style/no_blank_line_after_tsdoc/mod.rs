//! Reports a blank line between a TSDoc block and the declaration it documents, and fixes it
//! away.
//!
//! The blank line makes the comment look like it belongs to whatever sits above it, while TSDoc
//! tooling binds the comment to the declaration below regardless — the gap only misleads
//! readers. The fix drops the empty lines and keeps the declaration's own indentation. The doc
//! of an exported declaration sits above `export`, so the gap to measure ends at the export
//! wrapper rather than at the declaration inside it.

use oxc_ast::ast::{
    ArrowFunctionExpression, Class, Declaration, ExportDefaultDeclarationKind, Expression,
    Function, Program, Statement, VariableDeclarator,
};

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

    fn check_class(&mut self, class: &'a Class<'a>, wrapper: u32) {
        let name = class.id.as_ref().map(|id| String::from(id.name.as_str()));

        self.check(wrapper, "class", name);
        self.visit_class(class);
    }

    /// The declarator of an exported `const` whose initializer is a function, if any.
    fn exported_function(declaration: &'a Declaration<'a>) -> Option<&'a VariableDeclarator<'a>> {
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

    fn visit_statement(&mut self, statement: &'a Statement<'a>, exported: Option<u32>) {
        match statement {
            Statement::FunctionDeclaration(function) => {
                self.check_function(function, exported.unwrap_or(function.span.start));
            }
            Statement::ClassDeclaration(class) => {
                self.check_class(class, exported.unwrap_or(class.span.start));
            }
            Statement::ExportDeclaration(export) => {
                let wrapper = export.span.start;

                match &export.declaration {
                    Declaration::FunctionDeclaration(function) => {
                        self.check_function(function, wrapper);
                    }
                    Declaration::ClassDeclaration(class) => {
                        self.check_class(class, wrapper);
                    }
                    Declaration::VariableDeclaration(_) => {
                        if let Some(declarator) = Self::exported_function(&export.declaration) {
                            self.check(wrapper, "exported function", declarator_name(declarator));
                        }
                    }
                    _ => {}
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                let wrapper = export.span.start;

                match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        self.check_function(function, wrapper);
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                        self.check_class(class, wrapper);
                    }
                    _ => {}
                }
            }
            Statement::BlockStatement(block) => {
                for nested in &block.body {
                    self.visit_statement(nested, None);
                }
            }
            Statement::ExpressionStatement(expression) => {
                self.visit_expression(&expression.expression);
            }
            Statement::VariableDeclaration(variable) => {
                for declarator in &variable.declarations {
                    if let Some(init) = &declarator.init {
                        self.visit_expression(init);
                    }
                }
            }
            Statement::ReturnStatement(returned) => {
                if let Some(argument) = &returned.argument {
                    self.visit_expression(argument);
                }
            }
            _ => {}
        }
    }

    /// Walks the expressions a nested class expression could hide behind.
    fn visit_expression(&mut self, expression: &'a Expression<'a>) {
        match expression {
            Expression::ClassExpression(class) => self.visit_class(class),
            Expression::ArrowFunctionExpression(arrow) => self.visit_arrow(arrow),
            Expression::FunctionExpression(function) => self.visit_function(function),
            Expression::BinaryExpression(binary) => {
                self.visit_expression(&binary.left);
                self.visit_expression(&binary.right);
            }
            Expression::LogicalExpression(logical) => {
                self.visit_expression(&logical.left);
                self.visit_expression(&logical.right);
            }
            Expression::ConditionalExpression(conditional) => {
                self.visit_expression(&conditional.consequent);
                self.visit_expression(&conditional.alternate);
            }
            Expression::ParenthesizedExpression(parenthesized) => {
                self.visit_expression(&parenthesized.expression);
            }
            _ => {}
        }
    }

    fn visit_arrow(&mut self, arrow: &'a ArrowFunctionExpression<'a>) {
        // Concise-bodied arrows hold only an expression — a class expression there would come
        // from a property initializer, which the expression walk already covers.
        if let oxc_ast::ast::ArrowFunctionBody::FunctionBody(body) = &arrow.body {
            for statement in &body.statements {
                self.visit_statement(statement, None);
            }
        }
    }

    fn visit_function(&mut self, function: &'a Function<'a>) {
        if let Some(body) = &function.body {
            for statement in &body.statements {
                self.visit_statement(statement, None);
            }
        }
    }

    fn visit_class(&mut self, class: &'a Class<'a>) {
        for element in &class.body.body {
            match element {
                oxc_ast::ast::ClassElement::MethodDefinition(method) => {
                    let start = member_start(method.span.start, &method.decorators);

                    self.check(start, "method", name_of_key(&method.key));
                    self.visit_function(&method.value);
                }
                oxc_ast::ast::ClassElement::PropertyDefinition(property) => {
                    if holds_function(property.value.as_ref()) {
                        let start = member_start(property.span.start, &property.decorators);

                        self.check(start, "class property", name_of_key(&property.key));
                    }

                    if let Some(value) = &property.value {
                        self.visit_expression(value);
                    }
                }
                _ => {}
            }
        }
    }
}

/// The bound name of one exported declarator, when it spells a plain identifier.
fn declarator_name(declarator: &VariableDeclarator<'_>) -> Option<String> {
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
    };

    for statement in &program.body {
        check.visit_statement(statement, None);
    }

    check.diagnostics
}
