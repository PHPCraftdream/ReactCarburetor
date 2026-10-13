use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, ImportDeclarationSpecifier,
    ImportOrExportKind, ModuleExportName, Program, PropertyKey, Statement,
};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{ReferenceFlags, Semantic, SymbolId};

/// React reserves `use` and use-prefixed camel-case exports for hook-style functions.
pub(super) fn is_hook_name(name: &str) -> bool {
    name == "use"
        || name
            .strip_prefix("use")
            .and_then(|tail| tail.as_bytes().first())
            .is_some_and(|first| first.is_ascii_uppercase() || first.is_ascii_digit())
}

#[derive(Clone, Copy)]
enum Binding<'a> {
    Namespace,
    Named(&'a str),
}

pub(super) struct ReactBindings<'a> {
    values: HashMap<SymbolId, Binding<'a>>,
}

/// Static `CommonJS` provenance; a locally shadowed require is not the module loader.
fn requires_react(call: &CallExpression<'_>, semantic: Option<&Semantic<'_>>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    if identifier.name != "require" || call.arguments.len() != 1 {
        return false;
    }
    if !matches!(&call.arguments[0], Argument::StringLiteral(value) if value.value == "react") {
        return false;
    }
    semantic.is_none_or(|semantic| {
        identifier
            .reference_id
            .get()
            .and_then(|id| semantic.scoping().get_reference(id).symbol_id())
            .is_none()
    })
}

struct RequiresReact {
    found: bool,
}

impl<'a> Visit<'a> for RequiresReact {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        self.found |= requires_react(call, None);
        if !self.found {
            walk::walk_call_expression(self, call);
        }
    }
}

impl<'a> ReactBindings<'a> {
    /// Parsed module names handle escaped spellings without raw-source heuristics.
    pub(super) fn has_react_source(program: &Program<'_>) -> bool {
        if program.body.iter().any(|statement| {
            matches!(statement,
            Statement::ImportDeclaration(import) if import.source.value == "react"
                && import.import_kind == ImportOrExportKind::Value)
        }) {
            return true;
        }
        let mut scan = RequiresReact { found: false };
        scan.visit_program(program);
        scan.found
    }

    /// Keeps symbol identities, so local shadowing never inherits an imported hook's identity.
    pub(super) fn from_program(program: &'a Program<'a>) -> Self {
        let mut values = HashMap::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.source.value != "react" || import.import_kind != ImportOrExportKind::Value {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                let (local, binding) = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        if specifier.import_kind != ImportOrExportKind::Value {
                            continue;
                        }
                        let name = match &specifier.imported {
                            ModuleExportName::IdentifierName(name) => name.name.as_str(),
                            ModuleExportName::IdentifierReference(name) => name.name.as_str(),
                            ModuleExportName::StringLiteral(name) => name.value.as_str(),
                        };
                        (&specifier.local, Binding::Named(name))
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        (&specifier.local, Binding::Namespace)
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        (&specifier.local, Binding::Namespace)
                    }
                };
                if let Some(symbol) = local.symbol_id.get() {
                    values.insert(symbol, binding);
                }
            }
        }
        Self { values }
    }

    fn origin(
        &self,
        expression: &Expression<'a>,
        semantic: &Semantic<'a>,
        depth: usize,
    ) -> Option<Binding<'a>> {
        if depth >= 8 {
            return None;
        }
        let next = depth.checked_add(1)?;
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => {
                let symbol = identifier
                    .reference_id
                    .get()
                    .and_then(|id| semantic.scoping().get_reference(id).symbol_id())?;
                if let Some(binding) = self.values.get(&symbol) {
                    return Some(*binding);
                }
                if semantic
                    .scoping()
                    .get_resolved_references(symbol)
                    .any(|reference| reference.flags().contains(ReferenceFlags::Write))
                {
                    return None;
                }
                let AstKind::VariableDeclarator(declaration) =
                    semantic.symbol_declaration(symbol).kind()
                else {
                    return None;
                };
                let value = declaration.init.as_ref()?;
                if declaration.id.get_binding_identifier().is_some() {
                    return self.origin(value, semantic, next);
                }
                let BindingPattern::ObjectPattern(pattern) = &declaration.id else {
                    return None;
                };
                if !matches!(
                    self.origin(value, semantic, next),
                    Some(Binding::Namespace)
                ) {
                    return None;
                }
                let property = pattern.properties.iter().find(|property| {
                    property
                        .value
                        .get_binding_identifier()
                        .and_then(|id| id.symbol_id.get())
                        == Some(symbol)
                })?;
                let name = match &property.key {
                    PropertyKey::StaticIdentifier(name) => name.name.as_str(),
                    PropertyKey::StringLiteral(name) => name.value.as_str(),
                    _ => return None,
                };
                Some(Binding::Named(name))
            }
            Expression::StaticMemberExpression(member) => matches!(
                self.origin(&member.object, semantic, next),
                Some(Binding::Namespace)
            )
            .then_some(Binding::Named(member.property.name.as_str())),
            Expression::ComputedMemberExpression(member) => {
                let Expression::StringLiteral(name) = member.expression.get_inner_expression()
                else {
                    return None;
                };
                matches!(
                    self.origin(&member.object, semantic, next),
                    Some(Binding::Namespace)
                )
                .then_some(Binding::Named(name.value.as_str()))
            }
            Expression::CallExpression(call) if requires_react(call, Some(semantic)) => {
                Some(Binding::Namespace)
            }
            _ => None,
        }
    }

    /// Resolves named imports, namespace calls and unmodified same-file forwarding aliases.
    pub(super) fn call_name(
        &self,
        expression: &Expression<'a>,
        semantic: &Semantic<'a>,
    ) -> Option<&'a str> {
        match self.origin(expression, semantic, 0) {
            Some(Binding::Named(name)) => Some(name),
            _ => None,
        }
    }
}
