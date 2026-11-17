//! Markup carries exactly one Function per element: `className="submit-button"`. A Tailwind
//! utility, a lower floor, several classes or a class name built at run time would put the visual
//! composition back into markup, where no rule can see it. A choice between Functions is a `?:`
//! between literals; state goes into `data-*` and `aria-*` attributes, which the Function's state
//! blocks select.

use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXOpeningElement, JSXSpreadAttribute, ObjectExpression, ObjectPropertyKind,
    Program, StringLiteral,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::rules::classes::css::bricks::{classify, split};
use crate::rules::classes::css::index::ClassIndex;
use crate::rules::classes::css::scan::Floor;
use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::{member_call_name, property_key_name};
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

/// [`check_with_index`] with the index the run handed the config, as both dispatch paths call it.
pub fn check_with_config(
    program: &Program<'_>,
    source: &Source<'_>,
    config: &crate::config::Config,
) -> Vec<Diagnostic> {
    check_with_index(program, source, config.class_index())
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

/// Whether a prop carries a class name: `className`, or a component's `inputClassName`-style prop
/// that hands one to an element inside.
fn is_class_prop(name: &str) -> bool {
    name == "className" || (name.ends_with("ClassName") && name.len() > "ClassName".len())
}

/// Whether a call creates an element from a props object: `createElement(type, props)`,
/// `React.createElement(...)`, or the automatic runtime's `jsx`/`jsxs`/`_jsx`/`_jsxs`.
fn creates_element(call: &CallExpression<'_>) -> bool {
    let name = match &call.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        callee => member_call_name(callee),
    };

    matches!(
        name,
        Some("createElement" | "jsx" | "jsxs" | "_jsx" | "_jsxs" | "jsxDEV" | "_jsxDEV")
    )
}

/// The literal text an attribute holds: a string, or a template or string in braces. A boolean
/// attribute (`<div data-busy />`) holds `"true"`, which is what React renders.
fn literal_value<'a>(value: Option<&'a JSXAttributeValue<'a>>) -> Option<&'a str> {
    match value {
        None => Some("true"),
        Some(JSXAttributeValue::StringLiteral(literal)) => Some(literal.value.as_str()),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container.expression.as_expression()? {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() && template.quasis.len() == 1 =>
                {
                    Some(template.quasis[0].value.raw.as_str())
                }
                _ => None,
            }
        }
        Some(_) => None,
    }
}

/// An attribute's name, when it is a plain one.
fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

/// Whether a camelCase style property paints a colour.
fn is_colour_style(property: &str) -> bool {
    property.ends_with("Color") || matches!(property, "color" | "background" | "fill" | "stroke")
}

/// Values that paint no colour of their own: an SVG's `fill: none`, inheritance, the text colour.
const NO_COLOUR: &[&str] = &[
    "none",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "currentcolor",
    "transparent",
];

/// CSS colour functions, lowercase.
const COLOUR_FUNCTIONS: &[&str] = &[
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "lab",
    "lch",
    "oklab",
    "oklch",
    "color",
    "color-mix",
    "light-dark",
];

/// Whether a value is a colour on its own: a hex, a colour function, a `var()`, or a bare word
/// (a named colour). `url(…)`, gradients and shorthand lists are not.
fn looks_like_colour(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with('#')
        || lower.starts_with("var(")
        || COLOUR_FUNCTIONS.iter().any(|function| {
            lower
                .strip_prefix(function)
                .is_some_and(|rest| rest.starts_with('('))
        })
        || (!lower.is_empty() && lower.bytes().all(|byte| byte.is_ascii_alphabetic()))
}

/// Whether a literal style value paints around the Roles. `background` is a shorthand, so only a
/// value that is a colour on its own counts there; a paint server (`fill: url(#gradient)`) is not a
/// colour anywhere.
fn paints_around_roles(property: &str, value: &str) -> bool {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    if is_role_value(value) || NO_COLOUR.contains(&lower.as_str()) || lower.starts_with("url(") {
        return false;
    }
    property != "background" || looks_like_colour(value)
}

/// Whether a style value is exactly one Role: `var(--color-…)`.
fn is_role_value(value: &str) -> bool {
    value
        .trim()
        .strip_prefix("var(--color-")
        .and_then(|rest| rest.strip_suffix(')'))
        .is_some_and(|role| !role.is_empty() && !role.contains(['(', ')', ',']))
}

impl Finder<'_, '_> {
    /// A literal colour in an inline `style` object paints around the Roles: the element's colour
    /// belongs to its Function's Tone. A value computed at run time (a user's chosen colour) and a
    /// `var(--color-…)` Role are left alone.
    fn style(&mut self, object: &ObjectExpression<'_>) {
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(name) = property_key_name(&property.key).filter(|name| is_colour_style(name))
            else {
                continue;
            };
            let value = match &property.value {
                Expression::StringLiteral(literal) => literal.value.as_str(),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() && template.quasis.len() == 1 =>
                {
                    template.quasis[0].value.raw.as_str()
                }
                _ => continue,
            };
            if paints_around_roles(name, value) {
                self.report(
                    property.value.span().start,
                    format!(
                        "style {name}: {value:?} paints around the Roles; the element's colour belongs to its Function's Tone"
                    ),
                );
            }
        }
    }

    /// An element whose `className` is one Function: a literal `data-*`/`aria-*` value its state
    /// blocks select by must be one of the values they list. A Function that styles one value of
    /// an attribute leaves the others to its base look (`data-state="idle"` next to a `busy`
    /// block), and `aria-*="false"` is required by accessibility, so only an attribute with two or
    /// more listed values is checked, and `"false"` never is for `aria-*`.
    fn states(&mut self, element: &JSXOpeningElement<'_>) {
        let attributes = element.attributes.iter().filter_map(|item| match item {
            JSXAttributeItem::Attribute(attribute) => Some(&**attribute),
            JSXAttributeItem::SpreadAttribute(_) => None,
        });
        let function = attributes
            .clone()
            .find(|attribute| attribute_name(attribute) == Some("className"))
            .and_then(|attribute| literal_value(attribute.value.as_ref()))
            .map(str::trim)
            .filter(|name| self.index.floor(name) == Some(Floor::Function));
        let Some(function) = function else {
            return;
        };

        for attribute in attributes {
            let Some(name) = attribute_name(attribute)
                .filter(|name| name.starts_with("data-") || name.starts_with("aria-"))
            else {
                continue;
            };
            let (Some(values), Some(value)) = (
                self.index.state_values(function, name),
                literal_value(attribute.value.as_ref()),
            ) else {
                continue;
            };
            let is_default = values.len() < 2 || (name.starts_with("aria-") && value == "false");
            if !is_default && !values.iter().any(|known| known == value) {
                let at = attribute
                    .value
                    .as_ref()
                    .map_or(attribute.span.start, |value| value.span().start);
                let message = format!(
                    "{name}=\"{value}\" matches no state block of {function}, which selects {name} only by {}",
                    values
                        .iter()
                        .map(|known| format!("\"{known}\""))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                self.report(at, message);
            }
        }
    }

    /// The class props and the literal `style` object of a literal props object; other properties
    /// and spreads are not ours.
    fn object(&mut self, object: &ObjectExpression<'_>) {
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            match property_key_name(&property.key) {
                Some(name) if is_class_prop(name) => self.expression(&property.value),
                Some("style") => {
                    if let Expression::ObjectExpression(style) = &property.value {
                        self.style(style);
                    }
                }
                _ => {}
            }
        }
    }
}

impl<'a> Visit<'a> for Finder<'_, '_> {
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        self.states(element);

        walk::walk_jsx_opening_element(self, element);
    }

    fn visit_jsx_spread_attribute(&mut self, spread: &JSXSpreadAttribute<'a>) {
        if let Expression::ObjectExpression(object) = &spread.argument {
            self.object(object);
        }

        walk::walk_jsx_spread_attribute(self, spread);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if creates_element(call) {
            if let Some(Argument::ObjectExpression(props)) = call.arguments.get(1) {
                self.object(props);
            }
        }

        walk::walk_call_expression(self, call);
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        if attribute_name(attribute) == Some("style") {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value {
                if let Some(Expression::ObjectExpression(object)) =
                    container.expression.as_expression()
                {
                    self.style(object);
                }
            }
        }

        let is_class_name = matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if is_class_prop(identifier.name.as_str())
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
