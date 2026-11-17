//! Markup carries exactly one Function per element: `className="submit-button"`. A Tailwind
//! utility, a lower floor, several classes or a class name built at run time would put the visual
//! composition back into markup, where no rule can see it. A choice between Functions is a `?:`
//! between literals; state goes into `data-*` and `aria-*` attributes, which the Function's state
//! blocks select.

use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeName, JSXAttributeValue, Program, StringLiteral,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::rules::classes::css::bricks::{classify, split};
use crate::rules::classes::css::index::ClassIndex;
use crate::rules::classes::css::scan::Floor;
use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under.
pub const RULE: &str = "carburetor/require-function-class";

const DYNAMIC: &str = "className must be one Function written as a string literal, or a ?: \
    between such literals; move state into data-* or aria-* attributes, which the Function's \
    state blocks select";

/// The registry entry. Without a class index there is nothing to check against; the dispatch calls
/// [`check_with_index`] with the run's index instead.
pub fn check(_program: &Program<'_>, _source: &Source<'_>, _bases: &Bases) -> Vec<Diagnostic> {
    Vec::new()
}

/// Checks every `className` in a file against the class index.
pub fn check_with_index(
    program: &Program<'_>,
    source: &Source<'_>,
    index: Option<&ClassIndex>,
) -> Vec<Diagnostic> {
    let Some(index) = index else {
        return Vec::new();
    };
    let mut finder = Finder {
        source,
        index,
        diagnostics: Vec::new(),
    };
    finder.visit_program(program);
    finder.diagnostics
}

struct Finder<'s, 'i> {
    source: &'s Source<'s>,
    index: &'i ClassIndex,
    diagnostics: Vec<Diagnostic>,
}

impl Finder<'_, '_> {
    fn report(&mut self, offset: u32, message: String) {
        self.diagnostics
            .push(report(self.source, offset, RULE, message));
    }

    /// One literal class list, whose first character sits at `offset`.
    fn literal(&mut self, text: &str, offset: u32) {
        let names: Vec<(usize, &str)> = text
            .split_ascii_whitespace()
            .map(|name| {
                let start = name.as_ptr() as usize - text.as_ptr() as usize;
                (start, name)
            })
            .collect();

        match names.as_slice() {
            [] => self.report(
                offset,
                "className is empty; an element carries exactly one Function".to_string(),
            ),
            [(start, name)] => self.name(name, offset + *start as u32),
            [_, (start, _), ..] => self.report(
                offset + *start as u32,
                format!(
                    "className holds {} classes; an element carries exactly one Function",
                    names.len()
                ),
            ),
        }
    }

    fn name(&mut self, name: &str, offset: u32) {
        let message = match self.index.floor(name) {
            Some(Floor::Function) => return,
            Some(floor) => format!(
                "{name} is a {}; markup carries only Functions",
                floor.label()
            ),
            None => {
                let token = split(name);
                let is_utility = !token.variants.is_empty()
                    || classify(token.utility, &|role| self.index.is_role(role)).is_some();
                if is_utility {
                    format!("{name} is a Tailwind utility; markup carries only Functions")
                } else {
                    format!("{name} is not a Function the configured CSS defines")
                }
            }
        };
        self.report(offset, message);
    }

    fn string(&mut self, literal: &StringLiteral<'_>) {
        self.literal(literal.value.as_str(), literal.span.start + 1);
    }

    fn expression(&mut self, expression: &Expression<'_>) {
        match expression {
            Expression::StringLiteral(literal) => self.string(literal),
            Expression::TemplateLiteral(template)
                if template.expressions.is_empty() && template.quasis.len() == 1 =>
            {
                self.literal(
                    template.quasis[0].value.raw.as_str(),
                    template.span.start + 1,
                );
            }
            Expression::ConditionalExpression(conditional) => {
                self.expression(&conditional.consequent);
                self.expression(&conditional.alternate);
            }
            Expression::ParenthesizedExpression(inner) => self.expression(&inner.expression),
            Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => {}
            Expression::NullLiteral(_) => {}
            other => self.report(other.span().start, DYNAMIC.to_string()),
        }
    }
}

impl<'a> Visit<'a> for Finder<'_, '_> {
    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        let is_class_name = matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name.as_str() == "className"
        );

        if is_class_name {
            match &attribute.value {
                None => {}
                Some(JSXAttributeValue::StringLiteral(literal)) => self.string(literal),
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    if let Some(expression) = container.expression.as_expression() {
                        self.expression(expression);
                    }
                }
                Some(other) => self.report(other.span().start, DYNAMIC.to_string()),
            }
        }

        walk::walk_jsx_attribute(self, attribute);
    }
}

#[cfg(test)]
mod tests;
