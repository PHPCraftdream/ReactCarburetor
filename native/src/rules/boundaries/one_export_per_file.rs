//! At most one runtime-value export per file.
//!
//! Every top-level runtime export after the first is reported: bindings, functions, classes,
//! enums, namespaces, default exports and `export =` all count. Type exports (`export type`,
//! `export interface`, `export type {..}`, type-only specifiers) are unlimited, ambient
//! `declare` forms are not runtime values, re-exports and barrels do not declare anything
//! here, and whole `.d.ts` files are exempt. The fix is always the same shape: give each value
//! its own module.

use std::collections::HashSet;

use oxc_ast::ast::{
    Declaration, ExportDefaultDeclarationKind, ExportSpecifier, ImportOrExportKind,
    ModuleExportName, Program, Statement, TSNamespaceDeclaration, TSNamespaceDeclarationBody,
};
use oxc_ast::AstKind;
use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::build_semantic;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/one-export-per-file";

/// The message shown for every export after the first, naming the value that got there first.
fn message(first: &str) -> String {
    format!(
        "the file already exports the value \"{first}\"; move this export into its own file — \
         type exports are not limited by this rule"
    )
}

/// Whether every statement of a namespace's body is a type shape, which makes the namespace
/// itself type-only (`namespace` and `module` bodies recurse).
fn namespace_is_type_only(declaration: &TSNamespaceDeclaration<'_>) -> bool {
    match &declaration.body {
        TSNamespaceDeclarationBody::TSModuleBlock(block) => {
            block.body.iter().all(statement_is_type_only)
        }
        TSNamespaceDeclarationBody::TSNamespaceDeclaration(nested) => {
            namespace_is_type_only(nested)
        }
    }
}

/// Whether a statement inside a namespace is a type shape (an interface, a type alias, an
/// `export` of one, or a nested namespace that is type-only all the way down).
fn statement_is_type_only(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::TSInterfaceDeclaration(_) | Statement::TSTypeAliasDeclaration(_) => true,
        Statement::TSNamespaceDeclaration(nested) => namespace_is_type_only(nested),
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::TSInterfaceDeclaration(_) | Declaration::TSTypeAliasDeclaration(_) => true,
            Declaration::TSNamespaceDeclaration(nested) => namespace_is_type_only(nested),
            _ => false,
        },
        _ => false,
    }
}

/// Whether the symbol a local `export {name}` names carries only a type into this file, by the
/// kind of its declaration; a name that resolves to nothing counts as a value.
fn specifier_is_type_only(name: &str, semantic: &Semantic<'_>) -> bool {
    let scoping = semantic.scoping();
    let Some(symbol) = scoping.find_binding(scoping.root_scope_id(), name.into()) else {
        return false;
    };

    match semantic.symbol_declaration(symbol).kind() {
        AstKind::TSInterfaceDeclaration(_) | AstKind::TSTypeAliasDeclaration(_) => true,
        AstKind::ImportSpecifier(specifier) => specifier.import_kind == ImportOrExportKind::Type,
        // `import type X from ...` puts its kind on the declaration, not the specifier.
        AstKind::ImportDefaultSpecifier(specifier) => import_is_type_only(semantic, specifier.span),
        AstKind::ImportNamespaceSpecifier(specifier) => {
            import_is_type_only(semantic, specifier.span)
        }
        _ => false,
    }
}

/// Whether the import declaration holding `specifier_span` was written `import type`.
fn import_is_type_only(semantic: &Semantic<'_>, specifier_span: Span) -> bool {
    let node = semantic
        .nodes()
        .iter()
        .find(|node| node.kind().span() == specifier_span);

    let Some(node) = node else {
        return false;
    };

    matches!(
        semantic.nodes().parent_node(node.id()).kind(),
        AstKind::ImportDeclaration(import) if import.import_kind == ImportOrExportKind::Type
    )
}

/// The exported name of one local `export {..}` specifier, when it spells a plain identifier.
fn specifier_name<'a>(specifier: &ExportSpecifier<'a>) -> Option<&'a str> {
    match &specifier.local {
        ModuleExportName::IdentifierName(name) => Some(name.name.as_str()),
        ModuleExportName::IdentifierReference(name) => Some(name.name.as_str()),
        ModuleExportName::StringLiteral(_) => None,
    }
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    diagnostics: Vec<Diagnostic>,
    /// The name of the first runtime export, quoted in every later report.
    first: Option<&'a str>,
    /// Function names already exported, so TypeScript overloads count once.
    functions: HashSet<&'a str>,
}

impl<'a, 's> Check<'a, 's> {
    /// Records one runtime export and reports it when it is not the first.
    fn count(&mut self, span: Span, name: &'a str) {
        let Some(first) = self.first.as_ref() else {
            self.first = Some(name);

            return;
        };

        self.diagnostics
            .push(report(self.source, span.start, RULE, message(first)));
    }

    fn visit_statement(&mut self, statement: &Statement<'a>) {
        match statement {
            Statement::ExportDeclaration(export) => {
                self.visit_export_declaration(&export.declaration);
            }
            Statement::ExportDefaultDeclaration(export) => {
                let (span, name) = match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        let span = function.id.as_ref().map_or(export.span, |id| id.span);

                        (span, "default")
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                        let span = class.id.as_ref().map_or(export.span, |id| id.span);

                        (span, "default")
                    }
                    _ => (export.span, "default"),
                };

                self.count(span, name);
            }
            Statement::ExportNamedDeclaration(export) => {
                if export.export_kind == ImportOrExportKind::Type {
                    return;
                }

                for specifier in &export.specifiers {
                    if specifier.export_kind == ImportOrExportKind::Type {
                        continue;
                    }

                    let Some(name) = specifier_name(specifier) else {
                        // A string export name cannot resolve to a declaration; count it as a value.
                        self.count(specifier.span, "");

                        continue;
                    };

                    if !specifier_is_type_only(name, self.semantic) {
                        self.count(specifier.span, name);
                    }
                }
            }
            // Re-exports (`export {x} from`, `export *`, `export * as ns from`) declare nothing here.
            Statement::ExportFromDeclaration(_) | Statement::ExportAllDeclaration(_) => {}
            Statement::TSExportAssignment(assignment) => {
                self.count(assignment.span, "export =");
            }
            _ => {}
        }
    }

    fn visit_export_declaration(&mut self, declaration: &Declaration<'a>) {
        match declaration {
            Declaration::VariableDeclaration(variable) => {
                if variable.declare {
                    return;
                }

                for declarator in &variable.declarations {
                    for identifier in declarator.id.get_binding_identifiers() {
                        self.count(identifier.span, identifier.name.as_str());
                    }
                }
            }
            Declaration::FunctionDeclaration(function) => {
                if function.declare {
                    return;
                }

                let Some(id) = &function.id else {
                    return;
                };

                // Overloads share a name; only the first occurrence is an export of its own.
                if !self.functions.insert(id.name.as_str()) {
                    return;
                }

                self.count(id.span, id.name.as_str());
            }
            Declaration::ClassDeclaration(class) => {
                if class.declare {
                    return;
                }

                if let Some(id) = &class.id {
                    self.count(id.span, id.name.as_str());
                }
            }
            Declaration::TSEnumDeclaration(enumeration) => {
                if enumeration.declare {
                    return;
                }

                self.count(enumeration.id.span, enumeration.id.name.as_str());
            }
            Declaration::TSNamespaceDeclaration(namespace) => {
                if namespace.declare || namespace_is_type_only(namespace) {
                    return;
                }

                self.count(namespace.id.span, namespace.id.name.as_str());
            }
            // Type shapes and ambient modules are unlimited; `export declare const x: number`
            // never reaches the emitted module at all.
            _ => {}
        }
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source,
    semantic: &Semantic<'a>,
) -> Vec<Diagnostic> {
    // Declaration files only ever contain type shapes; there is nothing to limit in one.
    if source
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".d.ts"))
    {
        return Vec::new();
    }

    let mut check = Check {
        source,
        semantic,
        diagnostics: Vec::new(),
        first: None,
        functions: HashSet::new(),
    };

    for statement in &program.body {
        check.visit_statement(statement);
    }

    check
        .diagnostics
        .sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::bases::Bases;
    use crate::rules::support::testing::{diagnose, lines};
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    #[test]
    fn a_single_value_export_is_correct() {
        let source = "export const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_second_value_export_is_reported() {
        let source = "export const a = 1;\nexport const b = 2;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn each_export_after_the_first_is_reported() {
        let source = "export const a = 1;\nexport const b = 2;\nexport function c() {}\n";

        assert_eq!(lines(&diagnose(source, check)), [2, 3]);
    }

    #[test]
    fn type_exports_are_unlimited() {
        let source = "export type A = string;\nexport interface B {}\nexport type {A, B};\nexport const one = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_type_only_specifier_does_not_count() {
        let source = "type A = string;\nconst b = 2;\nexport {type A, b};\nexport const c = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_destructuring_export_counts_each_bound_name() {
        let source = "const o = {};\nexport const {a, b} = o;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn function_overloads_count_once() {
        let source =
            "export function f(x: string): string;\nexport function f(x: number): number;\n\
                      export function f(x: any): any { return x; }\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_enum_is_a_value_export() {
        let source = "export enum E { A }\nexport const x = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_const_enum_is_a_value_export() {
        let source = "export const enum CE { A }\nexport const x = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn declare_forms_are_not_runtime_exports() {
        let source = "export declare const d: number;\nexport declare function df(): void;\n\
                      export declare class DC {}\nexport declare namespace DN { const x: number; }\n\
                      export const a = 1;\nexport const b = 2;\n";

        assert_eq!(lines(&diagnose(source, check)), [6]);
    }

    #[test]
    fn re_exports_are_not_counted() {
        let source = "export * from 'mod';\nexport {x} from 'mod';\n\
                      export * as ns from 'mod';\nexport const one = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_default_export_counts_as_a_value() {
        let source = "export default function() {}\nexport const x = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_type_only_namespace_is_not_a_value_export() {
        let source = "export namespace Types { export type A = string; interface B {} }\nexport const x = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_runtime_namespace_is_a_value_export() {
        let source = "export namespace Runtime { export const v = 1; }\nexport const x = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_declaration_file_is_skipped_entirely() {
        let allocator = Allocator::default();
        let text = "export declare const a: number;\nexport declare const b: number;\n";
        let parsed = Parser::new(
            &allocator,
            text,
            SourceType::from_path("x.d.ts").unwrap_or_default(),
        )
        .parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

        let path = Path::new("types.d.ts");
        let source = Source::new(path, text);

        assert_eq!(
            lines(&check(&parsed.program, &source, &Bases::default())),
            [] as [usize; 0]
        );
    }
}
