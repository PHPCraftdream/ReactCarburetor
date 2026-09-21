//! H13: a lifecycle method declared as a class property.
//!
//! A class field is installed on the instance and shadows the prototype method for good, so the
//! base implementation React would have called is gone — in an earlier version of this library
//! exactly this silently disabled every effect in a component. See docs/hazards.md, H13.

use oxc_ast::ast::{Class, ClassElement, Expression, Program, PropertyKey};
use oxc_ast_visit::Visit;

use crate::rules::report;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-lifecycle-class-property";

const COMPONENT_BASES: [&str; 2] = ["AntiHookComponent", "ScopedAntiHookComponent"];

const LIFECYCLE_NAMES: [&str; 7] = [
    "render",
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
];

/// The name a base class is referenced by, bare or through a namespace.
fn super_class_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

fn is_component(class: &Class<'_>) -> bool {
    class
        .heritage
        .as_ref()
        .and_then(|heritage| super_class_name(&heritage.expression))
        .is_some_and(|name| COMPONENT_BASES.contains(&name))
}

/// The name a class member is declared under, when it is knowable statically.
fn member_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

struct Visitor<'a> {
    source: &'a Source<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Visit<'a> for Visitor<'a> {
    fn visit_class(&mut self, class: &Class<'a>) {
        if is_component(class) {
            for element in &class.body.body {
                let ClassElement::PropertyDefinition(property) = element else {
                    continue;
                };

                if property.r#static {
                    continue;
                }

                let Some(name) = member_name(&property.key) else {
                    continue;
                };

                if !LIFECYCLE_NAMES.contains(&name) {
                    continue;
                }

                self.diagnostics.push(report(
                    self.source,
                    property.span.start,
                    RULE,
                    format!(
                        "\"{name}\" is declared as a class property, which shadows the base \
                         implementation on the prototype: effects, subscription cleanup or the \
                         props gate will silently stop working. Declare it as a method and call \
                         super, or override useEffects/unUseEffects instead."
                    ),
                ));
            }
        }

        // Keep walking: a class can hold another class, and a class expression can sit anywhere.
        oxc_ast_visit::walk::walk_class(self, class);
    }
}

pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut visitor = Visitor {
        source,
        diagnostics: Vec::new(),
    };

    visitor.visit_program(program);

    visitor.diagnostics
}
