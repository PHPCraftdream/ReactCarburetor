//! Allocation-free classification of JSX opening tags.

use oxc_ast::ast::{JSXElementName, JSXMemberExpression, JSXMemberExpressionObject};

/// How a JSX element's tag classifies: only [`JsxTag::Component`] counts as a nesting level.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JsxTag {
    /// A lowercase DOM tag, a namespaced name — anything that is not a component.
    Dom,
    /// The `Fragment` / `React.Fragment` spellings, which nest without counting.
    Fragment,
    /// An uppercase identifier or member name — a level in the tree.
    Component,
}

/// Whether a member tag is one of the fragment spellings, `React.Fragment` exactly.
fn is_fragment_member(member: &JSXMemberExpression<'_>) -> bool {
    matches!(
        &member.object,
        JSXMemberExpressionObject::IdentifierReference(identifier) if identifier.name == "React"
    ) && member.property.name == "Fragment"
}

/// Classifies an opening tag without allocating a name: DOM, fragment, or component level.
pub(super) fn jsx_tag(name: &JSXElementName<'_>) -> JsxTag {
    match name {
        JSXElementName::Identifier(identifier) => jsx_identifier_tag(&identifier.name),
        JSXElementName::IdentifierReference(identifier) => jsx_identifier_tag(&identifier.name),
        JSXElementName::MemberExpression(member) => {
            if is_fragment_member(member) {
                JsxTag::Fragment
            } else {
                JsxTag::Component
            }
        }
        _ => JsxTag::Dom,
    }
}

/// Classifies a bare identifier tag; `Fragment` nests without counting, whatever its case.
fn jsx_identifier_tag(name: &str) -> JsxTag {
    if name == "Fragment" {
        JsxTag::Fragment
    } else if name.chars().next().is_some_and(char::is_uppercase) {
        JsxTag::Component
    } else {
        JsxTag::Dom
    }
}
