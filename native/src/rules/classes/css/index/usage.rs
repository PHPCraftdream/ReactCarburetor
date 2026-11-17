//! What a stylesheet uses, as opposed to what it defines: every class an `@apply` names, at any
//! depth, and every custom property a `var(…)` reads. The index joins these across files so a
//! definition nobody uses can be told apart.

use crate::rules::classes::css::parse::Node;

/// Every class named by an `@apply`, and every custom property read through `var(--…)` (without
/// the leading `--`), anywhere in the nodes.
pub fn usages(nodes: &[Node], text: &str, classes: &mut Vec<String>, vars: &mut Vec<String>) {
    for node in nodes {
        match node {
            Node::At(rule) => {
                if rule.name.text(text).eq_ignore_ascii_case("apply") {
                    classes.extend(
                        crate::rules::classes::apply_classes(rule, text)
                            .into_iter()
                            .map(|applied| applied.class.to_string()),
                    );
                }
                read_vars(rule.prelude.text(text), vars);
                if let Some(block) = &rule.block {
                    usages(block, text, classes, vars);
                }
            }
            Node::Rule(rule) => usages(&rule.body, text, classes, vars),
            Node::Declaration(declaration) => read_vars(declaration.value.text(text), vars),
        }
    }
}

/// The custom properties a value reads: `var(--palette-blue-600)` gives `palette-blue-600`, and so
/// does the `(--color-…)` shorthand of an arbitrary Tailwind value.
pub fn read_vars(value: &str, vars: &mut Vec<String>) {
    let mut rest = value;
    while let Some(start) = rest.find("--") {
        let after = &rest[start + 2..];
        let end = after
            .find(|character: char| {
                !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
            })
            .unwrap_or(after.len());
        if end > 0 && !after[..end].ends_with('*') {
            vars.push(after[..end].to_string());
        }
        rest = &after[end..];
    }
}
