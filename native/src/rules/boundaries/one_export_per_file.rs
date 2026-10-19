//! At most one runtime-value export per file.
//!
//! Every top-level runtime-value export after the first is reported: bindings, functions,
//! classes, enums, namespaces, `export import A = B.C`, default exports and `export =` all
//! count. Overload groups — including `export default` overloads — count once. Type-only
//! default exports (`export default interface`) do not count. A local `export {X}` counts only
//! when `X` resolves to a runtime value declared or imported at the top level: a parent
//! `import type` and ambient `declare` forms make it type-only, while a value wins over a
//! same-named type. Type exports (`export type`, `export interface`, `export type {..}`,
//! type-only specifiers) are unlimited, re-exports and barrels do not declare anything here,
//! and whole `.d.ts` files are exempt. The fix is always the same shape: give each value its
//! own module.
//!
//! The classification is a linear pre-pass over the module body: phase 1 collects the set of
//! top-level names bound to runtime values, phase 2 walks the exports in order, so no
//! per-specifier symbol lookup is needed.

use std::collections::HashSet;

use oxc_ast::ast::{
    Declaration, ExportDefaultDeclarationKind, ExportSpecifier, ImportDeclarationSpecifier,
    ImportOrExportKind, ModuleExportName, Program, Statement, TSNamespaceDeclaration,
    TSNamespaceDeclarationBody,
};
use oxc_semantic::Semantic;
use oxc_span::Span;

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

/// The exported name of one local `export {..}` specifier, when it spells a plain identifier.
fn specifier_name<'a>(specifier: &ExportSpecifier<'a>) -> Option<&'a str> {
    match &specifier.local {
        ModuleExportName::IdentifierName(name) => Some(name.name.as_str()),
        ModuleExportName::IdentifierReference(name) => Some(name.name.as_str()),
        ModuleExportName::StringLiteral(_) => None,
    }
}

/// The set of top-level names in this module bound to a runtime value.
fn collect_values<'a>(program: &'a Program<'a>) -> HashSet<&'a str> {
    let mut values = HashSet::new();

    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                if import.import_kind == ImportOrExportKind::Type {
                    continue;
                }

                for specifier in import.specifiers.iter().flatten() {
                    match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                            if specifier.import_kind != ImportOrExportKind::Type {
                                values.insert(specifier.local.name.as_str());
                            }
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                            values.insert(specifier.local.name.as_str());
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            values.insert(specifier.local.name.as_str());
                        }
                    }
                }
            }
            Statement::TSImportEqualsDeclaration(imp) => {
                if imp.import_kind != ImportOrExportKind::Type {
                    values.insert(imp.id.name.as_str());
                }
            }
            Statement::ExportDeclaration(export) => {
                collect_declaration_value(&export.declaration, &mut values);
            }
            _ => {}
        }
    }

    values
}

/// Inserts the name a top-level `export <declaration>` binds, when it is a runtime value.
fn collect_declaration_value<'a>(declaration: &Declaration<'a>, values: &mut HashSet<&'a str>) {
    match declaration {
        Declaration::VariableDeclaration(variable) if !variable.declare => {
            for declarator in &variable.declarations {
                for identifier in declarator.id.get_binding_identifiers() {
                    values.insert(identifier.name.as_str());
                }
            }
        }
        Declaration::FunctionDeclaration(function) if !function.declare => {
            if let Some(id) = &function.id {
                values.insert(id.name.as_str());
            }
        }
        Declaration::ClassDeclaration(class) if !class.declare => {
            if let Some(id) = &class.id {
                values.insert(id.name.as_str());
            }
        }
        Declaration::TSEnumDeclaration(enumeration) if !enumeration.declare => {
            values.insert(enumeration.id.name.as_str());
        }
        Declaration::TSNamespaceDeclaration(namespace)
            if !namespace.declare && !namespace_is_type_only(namespace) =>
        {
            values.insert(namespace.id.name.as_str());
        }
        Declaration::TSImportEqualsDeclaration(imp)
            if imp.import_kind != ImportOrExportKind::Type =>
        {
            values.insert(imp.id.name.as_str());
        }
        // Type shapes, declare forms and ambient modules are not runtime values.
        _ => {}
    }
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// The name of the first runtime export, quoted in every later report.
    first: Option<&'a str>,
    /// Export names already seen, so overload groups and repeated names count once.
    exported: HashSet<&'a str>,
    /// Top-level names bound to runtime values, from the linear pre-pass.
    values: HashSet<&'a str>,
}

impl<'a, 's> Check<'a, 's> {
    /// Records one runtime export and reports it when it is not the first.
    fn count(&mut self, span: Span, name: &'a str) {
        if !name.is_empty() && !self.exported.insert(name) {
            return;
        }

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
                if matches!(
                    &export.declaration,
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_)
                ) {
                    return;
                }

                self.count(export.span, "default");
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

                    if self.values.contains(name) {
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
            Declaration::TSImportEqualsDeclaration(imp)
                if imp.import_kind != ImportOrExportKind::Type =>
            {
                self.count(imp.id.span, imp.id.name.as_str());
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
    _semantic: &Semantic<'a>,
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
        diagnostics: Vec::new(),
        first: None,
        exported: HashSet::new(),
        values: collect_values(program),
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
    fn default_function_overloads_count_once() {
        let source = "export default function f(x: string): string;\n\
                      export default function f(x: number): number;\n\
                      export default function f(x: any): any { return x; }\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn default_overloads_then_a_second_export() {
        let source = "export default function f(x: string): string;\n\
                      export default function f(x: number): number;\n\
                      export default function f(x: any): any { return x; }\n\
                      export const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_default_interface_is_not_a_value_export() {
        let source = "export default interface Shape {}\nexport const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_export_import_equals_is_a_runtime_export() {
        let source = "namespace B { export const C = 1; }\nexport import A = B.C;\nexport const value = 2;\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_type_only_import_equals_is_not_a_runtime_export() {
        let source = "namespace B { export const C = 1; }\nexport import type A = B.C;\nexport const value = 2;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_parent_import_type_specifier_is_not_a_value() {
        let source = "import type {X} from \"types\";\nexport {X};\nexport const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_type_only_namespace_name_is_not_a_value() {
        let source =
            "namespace Types { export interface X {} }\nexport {Types};\nexport const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_ambient_name_is_not_a_value() {
        let source =
            "declare const external: number;\nexport {external};\nexport const value = 1;\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_value_wins_over_a_same_named_type() {
        let source = "const X = 1;\ntype X = number;\nexport {X};\nexport const y = 2;\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
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
