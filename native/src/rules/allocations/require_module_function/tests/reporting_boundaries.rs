use super::*;

#[test]
fn a_function_valued_field_is_reported_with_the_per_instance_wording() {
    let source = r#"
class Widget extends AntiHookComponent {
    format = (value: number): string => value.toFixed(2);
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);

    let message = &found[0].message;

    assert!(message.contains("allocated once per instance"), "{message}");
    assert!(
        message.contains("declare it once at module level"),
        "{message}"
    );
    assert!(
        !message.contains("allocates nothing per instance"),
        "{message}"
    );
}

#[test]
fn a_static_function_field_takes_the_plain_wording() {
    // A static field is built once per class, not once per instance, so the per-instance
    // wording would be wrong; what it costs is nothing, and module level is still where it
    // belongs.
    let source = r#"
class Widget extends AntiHookComponent {
    static format = (value: number): string => value.toFixed(2);
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].message.contains("belongs at module level"),
        "{}",
        found[0].message
    );
}

#[test]
fn an_arrow_field_and_its_nested_closure_are_reported_separately() {
    let source = r#"
class Widget extends AntiHookComponent {
    handler = () => {
        return [1].map((x) => x * 2);
    };
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3, 4]);
    assert!(found[0].message.contains("once per instance"));
    assert!(found[1].message.contains("every call"));
}

#[test]
fn a_computed_member_name_is_never_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    ["helper"](): number {
        return 1;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_same_file_subclass_of_a_component_subclass_is_still_in_scope() {
    let source = r#"
class Ground extends AntiHookComponent {}

class Top extends Ground {
    helper(): number {
        return 1;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [5]);
}

#[test]
fn a_subclass_of_an_imported_base_is_outside_the_same_file_walk() {
    // The documented limitation every rule in this crate shares.
    let source = r#"
import { External } from "./external";

class Widget extends External {
    helper(): number {
        return 1;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_closure_and_its_clean_member_both_report_in_one_pass() {
    let source = r#"
class Widget extends AntiHookComponent {
    helper() {
        return [1, 2].sort((a, b) => a - b);
    }
}
"#;

    assert_eq!(lines(&reported(source)), [3, 4]);
}

#[test]
fn a_plain_method_moves_out_and_its_this_references_become_bare_calls() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return this.#format(1);
    }

    #format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
function format(value: number): string {
        return value.toFixed(2);
    }

class Widget extends AntiHookComponent {
    render() {
        return format(1);
    }
}
"#
    );
}

#[test]
fn an_arrow_field_becomes_a_module_level_const() {
    let source = r#"
class Widget extends AntiHookComponent {
    bound = 1;

    #make = (value: number): string => value.toFixed(2);

    render() {
        return this.#make(1);
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
const make = (value: number): string => value.toFixed(2);

class Widget extends AntiHookComponent {
    bound = 1;

    render() {
        return make(1);
    }
}
"#
    );
}

#[test]
fn an_async_method_keeps_its_async_keyword() {
    let source = r#"
class Widget extends AntiHookComponent {
    async #load(url: string): Promise<string> {
        return url;
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
async function load(url: string): Promise<string> {
        return url;
    }

class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn an_async_private_arrow_field_keeps_async_after_const() {
    let source = r#"
class Widget extends AntiHookComponent {
    #load = async (url: string): Promise<string> => url;
}
"#;

    assert_eq!(
        fixed(source),
        r#"
const load = async (url: string): Promise<string> => url;

class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn a_generic_method_keeps_its_type_parameters() {
    let source = r#"
class Widget extends AntiHookComponent {
    #wrap<T>(value: T): T[] {
        return [value];
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
function wrap<T>(value: T): T[] {
        return [value];
    }

class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn a_private_method_loses_its_hash_and_so_do_its_call_sites() {
    let source = r#"
class Widget extends AntiHookComponent {
    #format(value: number): string {
        return value.toFixed(2);
    }

    #use(value: number): string {
        return this.#format(value);
    }
}
"#;

    // One pass cannot end clean here: extracting `#format` is what makes `use`
    // class-independent, so the fixed source earns a fresh report for `use` — the real
    // `--fix` loop takes it in the next pass, which is what `stabilized` drives.
    assert_eq!(
        stabilized(source),
        r#"
function format(value: number): string {
        return value.toFixed(2);
    }

function use(value: number): string {
        return format(value);
    }

class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn a_member_tsdoc_moves_along_with_the_extraction() {
    let source = r#"
class Widget extends AntiHookComponent {
    /**
     * Formats a value for display.
     */
    #format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
/**
 * Formats a value for display.
 */
function format(value: number): string {
        return value.toFixed(2);
    }

class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn the_function_goes_above_the_classs_own_leading_comment() {
    let source = r#"
/** A widget. */
class Widget extends AntiHookComponent {
    #format(): string {
        return "w";
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
function format(): string {
        return "w";
    }

/** A widget. */
class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn an_exported_class_keeps_its_export_keyword() {
    let source = r#"
export class Widget extends AntiHookComponent {
    #format(): string {
        return "w";
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
function format(): string {
        return "w";
    }

export class Widget extends AntiHookComponent {
}
"#
    );
}

#[test]
fn an_export_default_class_keeps_its_whole_statement() {
    let source = r#"
export default class extends AntiHookComponent {
    #format(): string {
        return "w";
    }
}
"#;

    assert_eq!(
        fixed(source),
        r#"
function format(): string {
        return "w";
    }

export default class extends AntiHookComponent {
}
"#
    );
}

#[test]
fn a_function_expression_field_reports_without_a_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    make = function (value: number) {
        return value;
    };
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "no module-level form is specified for it"
    );
}

#[test]
fn a_private_method_preserves_multiline_template_contents_when_extracted() {
    let source = "\nclass Widget extends AntiHookComponent {\n    #format(): string {\n        return `first\n            second`;\n    }\n}\n";
    let extracted = fixed(source);

    assert!(
        extracted.contains("`first\n            second`"),
        "template bytes must survive extraction: {extracted}"
    );
}

#[test]
fn a_private_method_preserves_jsx_text_when_extracted() {
    let source = r#"
class Widget extends AntiHookComponent {
    #markup() {
        return (
            <div>
                keep  this spacing
            </div>
        );
    }
}
"#;
    let extracted = fixed(source);

    assert!(
        extracted.contains("                keep  this spacing\n"),
        "JSX text bytes must survive extraction: {extracted}"
    );
}

#[test]
fn a_field_with_its_own_declared_type_reports_without_a_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    make: (value: number) => string = (value) => value.toFixed(2);
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "the declared type has no place on the extraction"
    );
}
