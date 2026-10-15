use super::*;

#[test]
fn clean_callbacks_inside_store_methods_report_for_both_scopes() {
    let source = r#"
class Cart extends Carburetor<{ count: number }> {
    inc() {
        self.update(draft => { draft.count += 1; });
        return [1].filter(item => item.done);
    }
}
"#;

    for scope in [ModuleFunctionScope::All, ModuleFunctionScope::Classes] {
        let found = reported_with_scope(source, scope);
        assert_eq!(found.iter().filter(|d| d.scope.as_deref() == Some("class")).count(), 2);
        assert!(found.iter().all(|d| d.rule == RULE));
    }
}

#[test]
fn clean_callbacks_in_classes_are_reported_for_component_and_store_bases() {
    for (base, scope) in [
        ("AntiHookComponent", ModuleFunctionScope::All),
        ("AntiHookComponent", ModuleFunctionScope::Classes),
        ("Carburetor", ModuleFunctionScope::All),
        ("Carburetor", ModuleFunctionScope::Classes),
    ] {
        let source = format!(
            "class Widget extends {base} {{\n    helper() {{\n        return this.items.filter(item => item.done);\n    }}\n}}"
        );
        let found = reported_with_scope(&source, scope);
        assert_eq!(found.iter().map(|d| d.rule.as_str()).collect::<Vec<_>>(), [RULE]);
        assert_eq!(found[0].scope.as_deref(), Some("class"));
    }
}

#[test]
fn method_callbacks_capturing_a_parameter_local_or_this_are_not_h30() {
    for expression in [
        "return this.items.filter(item => item.done && flag);",
        "const done = true; return this.items.filter(item => item.done && done);",
        "return this.items.filter(item => item.done && this.enabled);",
    ] {
        let source = format!(
            "class Widget extends AntiHookComponent {{\n    helper(flag: boolean) {{ {expression} }}\n}}"
        );
        for scope in [ModuleFunctionScope::All, ModuleFunctionScope::Classes] {
            assert!(reported_with_scope(&source, scope).is_empty(), "{source}");
        }
    }
}

// The `scope: "all"` half of the rule — the default. Any function nested inside another function,
// in plain module code (classes keep the member analysis below), that uses nothing around it —
// no `this`, `super`, `arguments`, `new.target`, no binding of an enclosing function — is
// reported at the function's start: it belongs at module level, declared once.

/// A nested arrow in a plain module function, capturing only its own parameter.
#[test]
fn a_nested_arrow_in_a_module_function_is_reported() {
    let source = r#"
function work(items: string[]) {
    return items.map((item) => item.length);
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
    assert!(found[0].message.contains("module level"), "{}", found[0].message);
    assert_eq!(found[0].scope.as_deref(), Some("module"));
}

/// A function declaration nested in a function is the same finding.
#[test]
fn a_nested_function_declaration_is_reported() {
    let source = r#"
function work() {
    function helper(value: number) {
        return value + 1;
    }

    return helper(1);
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);
}

/// An inner callback inside a top-level `computed(...)` body: the computed arrow itself sits at
/// module level, so only the filter arrow reports.
#[test]
fn an_inner_callback_inside_a_top_level_computed_is_reported() {
    let source = r#"
const done = computed(() => items.filter((item) => item.done));
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [2]);
    assert_eq!(found[0].scope.as_deref(), Some("module"));
}

/// A function handed straight to a top-level call is module-level code — never a finding.
#[test]
fn a_top_level_callback_argument_is_not_reported() {
    let source = r#"
const done = computed(() => items.length);
"#;

    assert!(reported(source).is_empty());
}

/// `this`, `arguments` and `new.target` do not survive a move; either disqualifies.
#[test]
fn a_function_using_this_arguments_or_new_target_is_not_reported() {
    let this_user = r#"
function outer() {
    const bound = () => this.value;

    return bound;
}
"#;
    let arguments_user = r#"
function outer() {
    function inner() {
        return arguments.length;
    }

    return inner();
}
"#;
    let new_target_user = r#"
function outer() {
    function inner() {
        return new.target;
    }

    return inner;
}
"#;

    assert!(reported(this_user).is_empty());
    assert!(reported(arguments_user).is_empty());
    assert!(reported(new_target_user).is_empty());
}

/// A closure over a local of the enclosing function cannot leave.
#[test]
fn a_closure_over_an_enclosing_local_is_not_reported() {
    let source = r#"
function outer() {
    const base = 10;

    return (value: number) => base + value;
}
"#;

    assert!(reported(source).is_empty());
}

/// Recursion by the function's own name is not a capture.
#[test]
fn recursion_on_its_own_name_is_not_a_capture() {
    let source = r#"
function outer() {
    function walk(steps: number) {
        return steps <= 0 ? 0 : walk(steps - 1);
    }

    return walk;
}
"#;

    assert_eq!(lines(&reported(source)), [3]);
}

/// Async functions and generators follow the same rule.
#[test]
fn an_async_or_generator_nested_function_is_reported() {
    let source = r#"
function work() {
    const load = async (url: string) => url;

    return load;
}

function more() {
    function* counter() {
        yield 1;
    }

    return counter;
}
"#;

    assert_eq!(lines(&reported(source)), [3, 9]);
}

/// Callbacks of the excluded APIs keep their protection — but only the callback itself: a
/// function nested *inside* one is an ordinary candidate.
#[test]
fn an_excluded_callback_is_protected_but_its_inner_functions_are_not() {
    let source = r#"
function work() {
    useEffect(() => {
        return [1].map((value) => value * 2);
    });
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [4]);
}

/// A function that is itself an IIFE callee runs where it is written; skip it.
#[test]
fn an_iife_callee_is_not_reported() {
    let source = r#"
function work() {
    return (() => 1)();
}
"#;

    assert!(reported(source).is_empty());
}

#[test]
fn classes_scope_reports_clean_nested_functions_inside_regular_class_methods() {
    let source = r#"
class Store {
    run(items: { done: boolean }[]) {
        return items.filter((item) => item.done);
    }
}
"#;

    let found = reported_with_scope(source, ModuleFunctionScope::Classes);

    assert_eq!(lines(&found), [4]);
    assert_eq!(found[0].scope.as_deref(), Some("class"));
}

#[test]
fn classes_scope_does_not_report_functions_outside_classes() {
    let source = r#"
function work(items: { done: boolean }[]) {
    return items.filter((item) => item.done);
}
"#;

    assert!(reported_with_scope(source, ModuleFunctionScope::Classes).is_empty());
}

#[test]
fn classes_scope_suppresses_module_function_reports() {
    let source = r#"
function work(items: string[]) {
    return items.map((item) => item.length);
}
"#;

    assert!(reported_with_scope(source, ModuleFunctionScope::Classes).is_empty());
}

#[test]
fn classes_scope_keeps_the_class_reports() {
    let source = r#"
class Widget extends AntiHookComponent {
    #make = (value: number): string => value.toFixed(2);
}
"#;

    let found = reported_with_scope(source, ModuleFunctionScope::Classes);

    assert_eq!(lines(&found), [3]);
    assert_eq!(found[0].scope.as_deref(), Some("class"));
}
