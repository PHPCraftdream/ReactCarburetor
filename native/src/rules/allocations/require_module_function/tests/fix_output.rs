use super::*;

#[test]
fn a_nested_class_reports_without_a_fix() {
    let source = r#"
function wrapper() {
    return class Widget extends AntiHookComponent {
        helper(): number {
            return 1;
        }
    };
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [4]);
    assert!(
        found[0].fix.is_none(),
        "the class is not a top-level statement"
    );
}

#[test]
fn a_class_expression_reports_without_a_fix() {
    let source = r#"
const Widget = class extends AntiHookComponent {
    helper(): number {
        return 1;
    }
};
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(found[0].fix.is_none(), "the class is not a statement");
}

#[test]
fn a_module_level_binding_of_the_same_name_blocks_the_fix() {
    let source = r#"
const format = String;

class Widget extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [5]);
    assert!(found[0].fix.is_none(), "the name is taken at module level");
}

#[test]
fn a_shadowing_local_at_a_call_site_blocks_the_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        function format(value: number) {
            return value;
        }

        return this.format(1) + format(2);
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [11]);
    assert!(
        found[0].fix.is_none(),
        "the rewritten call would hit the local"
    );
}

#[test]
fn a_foreign_object_reference_blocks_the_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    run(other: Widget): string {
        return other.format(1) + this.label;
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [7]);
    assert!(found[0].fix.is_none(), "other.format is not this.format");
}

#[test]
fn a_computed_string_key_reference_blocks_the_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    lookup(table: Record<string, number>): number {
        return table["format"] + this.label;
    }

    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [7]);
    assert!(
        found[0].fix.is_none(),
        "a computed key is not a form the rewrite replaces"
    );
}

#[test]
fn a_dynamic_this_key_blocks_extraction() {
    let source = r#"
class Widget extends AntiHookComponent {
    lookup(key: string): unknown {
        return this[key];
    }

    #format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [7]);
    assert!(
        found[0].fix.is_none(),
        "a dynamic member reference is not accounted for"
    );
}

#[test]
fn this_from_a_nested_regular_function_blocks_private_reference_rewriting() {
    let source = r#"
class Widget extends AntiHookComponent {
    #format(value: number): string {
        return value.toFixed(2);
    }

    #use(): string {
        function nested() {
            return this.#format(1);
        }
        return nested();
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "nested regular-function `this` is dynamic"
    );
}

#[test]
fn this_from_a_function_expression_field_blocks_private_reference_rewriting() {
    let source = r#"
class Widget extends AntiHookComponent {
    #format(value: number): string {
        return value.toFixed(2);
    }

    #callback = function () {
        return this.#format(1);
    };
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "function-expression field `this` is dynamic"
    );
}

#[test]
fn this_from_a_static_context_blocks_private_reference_rewriting() {
    let source = r#"
class Widget extends AntiHookComponent {
    #format(value: number): string {
        return value.toFixed(2);
    }

    static #use(): string {
        return this.#format(1);
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "static `this` is the class constructor"
    );
}

#[test]
fn destructuring_from_this_blocks_unproven_member_rewrites() {
    let source = r#"
class Widget extends AntiHookComponent {
    use(): number {
        const { format } = this;
        return format(1);
    }

    format(value: number): number {
        return value;
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [8]);
    assert!(
        found[0].fix.is_none(),
        "destructured member references are not rewritten"
    );
}

#[test]
fn a_super_reference_blocks_the_fix() {
    let source = r#"
class Ground extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}

class Widget extends Ground {
    pick(): string {
        return super.format(1) + this.label;
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "super.format keeps the member where it is"
    );
}

#[test]
fn a_this_reference_from_another_class_blocks_the_fix() {
    let source = r#"
class Other extends AntiHookComponent {
    pick(): string {
        return this.format(1) + this.label;
    }
}

class Widget extends AntiHookComponent {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [9]);
    assert!(
        found[0].fix.is_none(),
        "Other's this.format is another class's member"
    );
}

#[test]
fn a_class_name_reference_from_outside_blocks_the_fix() {
    let source = r#"
class Widget extends AntiHookComponent {
    static format(value: number): string {
        return value.toFixed(2);
    }
}

const behind = Widget.format(1);
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "Widget.format names the static from outside"
    );
}

#[test]
fn two_candidates_in_one_class_converge_across_passes() {
    // Both fixes replace the same class statement, so `apply` lands one per pass and
    // `stabilize` drives the second one home — the mechanism §7.3 leans on for any class
    // with more than one candidate.
    let source = r#"
class Widget extends AntiHookComponent {
    #first(): number {
        return 1;
    }

    #second(): number {
        return 2;
    }
}
"#;

    assert_eq!(
        stabilized(source),
        r#"
function first(): number {
        return 1;
    }

function second(): number {
        return 2;
    }

class Widget extends AntiHookComponent {
}
"#
    );
}
