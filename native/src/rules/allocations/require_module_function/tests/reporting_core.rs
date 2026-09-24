use super::*;

#[test]
fn a_sort_comparator_in_render_is_reported_as_a_module_level_function() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return this.rows.sort((a, b) => a - b);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [4]);

    let message = &found[0].message;

    assert!(message.contains("uses nothing from the class"), "{message}");
    assert!(message.contains("rebuilt on every render"), "{message}");
    assert!(
        message.contains("declare it once at module level"),
        "{message}"
    );
    assert!(!message.contains("taking"), "{message}");
}

#[test]
fn a_direct_helper_over_a_never_written_local_takes_it_as_a_parameter() {
    let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const suffix = "!";

        const label = (name: string) => name + suffix;

        return label(this.title);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [6]);

    let message = &found[0].message;

    assert!(
        message.contains("rebuilt on every call of `method`"),
        "{message}"
    );
    assert!(
        message.contains("taking `suffix` as a parameter"),
        "{message}"
    );
}

#[test]
fn a_callback_capturing_a_plain_local_is_not_reported() {
    // The local would freeze at closure creation, where a module-level function's parameter
    // would not — the same passability gate the method rule applies.
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        return <ul>{this.items.map((item) => <li key={item}>{suffix}</li>)}</ul>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_class_dependent_closure_is_the_other_rules_report_to_make() {
    let source = r#"
class Widget extends AntiHookComponent {
    method() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_private_method_that_uses_nothing_is_reported() {
    // D1: no visibility split — `#private` is eligible unconditionally, since nothing outside
    // the class can reference it by construction.
    let source = r#"
class Widget extends AntiHookComponent {
    #helper() {
        return compute();
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [3]);

    let message = &found[0].message;

    assert!(
        message.contains("allocates nothing per instance"),
        "{message}"
    );
    assert!(message.contains("belongs at module level"), "{message}");
}

#[test]
fn a_public_method_that_uses_nothing_is_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    public format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "public APIs may have cross-file callers"
    );
}

#[test]
fn a_protected_method_that_uses_nothing_is_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    protected format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [3]);
    assert!(
        found[0].fix.is_none(),
        "protected APIs may have cross-file callers"
    );
}

#[test]
fn lifecycle_names_are_never_reported_whatever_their_body_uses() {
    let source = r#"
class Widget extends AntiHookComponent {
    componentDidUpdate() {
        return Math.max(1, 2);
    }

    render() {
        return null;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn the_unsafe_prefix_is_a_lifecycle_name_whatever_the_suffix() {
    let source = r#"
class Widget extends AntiHookComponent {
    UNSAFE_componentWillMount() {
        return Math.max(1, 2);
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn the_base_class_override_surface_is_never_reported_whatever_the_form() {
    // Methods and function-valued fields alike: the base calls these as `this.<name>()`, so
    // the declaration's shape does not matter.
    let source = r#"
class Widget extends AntiHookComponent {
    protected useEffects(): void {
        return;
    }

    protected track(source: number): number {
        return source;
    }

    protected useEffect = (callBack: string, name: string): void => {};

    protected onCarburetorUpdate = (): void => {};
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn every_base_surface_name_is_still_declared_on_antihookcomponent_hierarchy() {
    struct Classes<'a>(Vec<&'a Class<'a>>);

    impl<'a> Visit<'a> for Classes<'a> {
        fn enter_node(&mut self, kind: AstKind<'a>) {
            if let AstKind::Class(class) = kind {
                self.0.push(class);
            }
        }
    }

    let mut declared = HashSet::new();
    let root = Path::new("../lib/src/Carburetor/Component/AntiHookComponent");
    let files = [
        "Foundation.tsx",
        "Reads.tsx",
        "Effects.tsx",
        "Subscriptions.tsx",
        "AntiHookComponent.tsx",
    ];

    for file in files {
        let path = root.join(file);
        let text = std::fs::read_to_string(path).expect("component source must exist");
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "{file} must parse: {:?}",
            parsed.diagnostics
        );

        let mut classes = Classes(Vec::new());
        classes.visit_program(&parsed.program);

        for class in classes.0 {
            for entry in &class.body.body {
                let name = match entry {
                    ClassElement::MethodDefinition(method) => member_name(&method.key),
                    ClassElement::PropertyDefinition(property) => member_name(&property.key),
                    _ => None,
                };

                if let Some(name) = name {
                    declared.insert(name.to_string());
                }
            }
        }
    }

    for name in BASE_SURFACE_MEMBERS {
        assert!(
            declared.contains(name),
            "{name} is on the base-surface list but no longer declared on \
                 the AntiHookComponent hierarchy — update the list"
        );
    }
}

#[test]
fn a_store_class_and_its_subclass_are_out_of_scope_entirely() {
    // D6 scope: store classes are never analysed by this rule, whatever a member's visibility
    // or its body's cleanliness.
    let source = r#"
class MyStore extends Carburetor {
    format(value: number): string {
        return value.toFixed(2);
    }

    protected helper(): number {
        return 1;
    }

    #privateHelper(): number {
        return 2;
    }
}

class SubStore extends MyStore {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn an_implements_clause_excludes_the_whole_class() {
    // The member may be satisfying the interface; without a type-checker the crate cannot
    // tell, so a report could break a real contract.
    let source = r#"
class Widget extends AntiHookComponent implements Formatter {
    format(value: number): string {
        return value.toFixed(2);
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn an_override_member_is_never_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    override toString(): string {
        return "widget";
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_decorated_member_is_never_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    @bind
    handle(value: number): number {
        return value + 1;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_getter_and_the_constructor_are_never_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    constructor() {}

    get label(): string {
        return "widget";
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn an_overload_signature_is_skipped_but_the_implementation_still_reports() {
    let source = r#"
class Widget extends AntiHookComponent {
    helper(value: number): number;
    helper(value: unknown): unknown {
        return value;
    }
}
"#;

    let found = reported(source);
    assert_eq!(lines(&found), [4]);
    assert!(
        found[0].fix.is_none(),
        "the implementation must stay beside its signatures"
    );

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
    let Statement::ClassDeclaration(class) = &parsed.program.body[0] else {
        panic!("fixture begins with a class declaration");
    };
    assert!(has_overload_signature(
        &parsed.program,
        class.span,
        "helper"
    ));
}

#[test]
fn an_abstract_method_is_skipped_for_want_of_a_body() {
    let source = r#"
abstract class Ground extends AntiHookComponent {
    abstract helper(): void;
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_class_type_parameter_is_a_class_dependency() {
    // `T` names the class without naming it; a module-level function could not carry it. This
    // is the shared analysis's own signal — the test confirms it reaches this rule.
    let source = r#"
class Widget<T> extends AntiHookComponent {
    wrap(value: T): T[] {
        return [value];
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn this_in_a_static_member_still_means_the_class() {
    let source = r#"
class Widget extends AntiHookComponent {
    static make(): Widget {
        return new this();
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_this_return_type_is_a_class_dependency_without_a_value_level_this() {
    let source = r#"
class Widget extends AntiHookComponent {
    fluent(): this {
        return undefined as unknown as this;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn another_instances_private_field_is_still_a_class_dependency() {
    let source = r#"
class Widget extends AntiHookComponent {
    #value = 1;

    positive(other: Widget): boolean {
        return other.#value > 0;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}
