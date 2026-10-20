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
    let source = "export function f(x: string): string;\nexport function f(x: number): number;\n\
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
    let source =
        "namespace B { export const C = 1; }\nexport import A = B.C;\nexport const value = 2;\n";

    assert_eq!(lines(&diagnose(source, check)), [3]);
}

#[test]
fn a_type_only_import_equals_is_not_a_runtime_export() {
    let source = "namespace B { export const C = 1; }\n\
                  export import type A = require(\"./b\");\n\
                  export const value = 2;\n";

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
    let source = "declare const external: number;\nexport {external};\nexport const value = 1;\n";

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
    let source =
        "export namespace Types { export type A = string; interface B {} }\nexport const x = 1;\n";

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
