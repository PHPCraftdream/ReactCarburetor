//! Reading names out of the AST, and only the ones that are knowable statically.
//!
//! A computed key or a computed member name is built at runtime, so a rule cannot reason about it;
//! every function here answers `None` in that case rather than guessing, because a report a reader
//! cannot verify is worse than no report.

use oxc_ast::ast::{Class, Expression, PropertyKey};

/// The method name in `something.name(...)`, given the call's callee.
pub fn member_call_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee {
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

/// Whether a call was made directly on `this`: `this.useCarburetor()` yes, `a.this` no.
pub fn called_on_this(callee: &Expression<'_>) -> bool {
    match callee {
        Expression::StaticMemberExpression(member) => {
            matches!(member.object, Expression::ThisExpression(_))
        }
        _ => false,
    }
}

/// The object a member call was made on, when it is a plain identifier.
pub fn call_receiver_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee {
        Expression::StaticMemberExpression(member) => match &member.object {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

/// The name a class member is declared under.
pub fn property_key_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

/// The name a base class is referenced by, bare or through a namespace.
pub fn super_class_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        // `carburetor.AntiHookComponent` — the last segment is the one that names the base.
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

/// Whether a class extends one of `bases`.
pub fn extends_any(class: &Class<'_>, bases: &[&str]) -> bool {
    class
        .heritage
        .as_ref()
        .and_then(|heritage| super_class_name(&heritage.expression))
        .is_some_and(|name| bases.contains(&name))
}

