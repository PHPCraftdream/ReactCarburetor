//! H29: a closure or a member that uses nothing from the class it sits in.
//!
//! Every call of the member builds the closure again — every render, when the member is `render` —
//! and a function-valued field is rebuilt once per instance: allocations the module does not need,
//! because the code depends on nothing around it. Where `require-method-for-closure` reports the
//! closures the class could own, this rule reports the opposite corner — the code that does not
//! need the class at all and can be declared once at module level, where one copy serves every
//! instance and every call. See docs/hazards.md, H29.
//!
//! A member is only a candidate when nothing outside this analysis's reach calls it by name: React
//! calls the lifecycle hooks on the instance, the component base calls its own override points as
//! `this.<name>()`, and an `implements` clause may be a contract the crate cannot see. Those stay
//! where they are whatever their bodies use.

use std::collections::HashMap;

use oxc_ast::ast::{
    Class, Expression, MethodDefinition, MethodDefinitionKind, Program, PropertyDefinition,
    PropertyKey,
};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::closures::{
    analyze_field, analyze_method, build_semantic, is_component_class, Candidate, Capture,
    MemberAnalysis, Usage,
};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-module-function";

/// The members React itself calls on the instance by name, so a body that uses nothing from the
/// class is still not free to leave — the caller is React, not this file. `render` is covered by
/// `RENDER_METHODS`; these are the rest of the lifecycle and static hooks.
const REACT_CALLED_MEMBERS: [&str; 8] = [
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
    "getDerivedStateFromProps",
    "getDerivedStateFromError",
];

/// React's experimental lifecycle prefix — `UNSAFE_componentWillMount` and friends — treated the
/// same whatever the suffix says.
const UNSAFE_PREFIX: &str = "UNSAFE_";

/// `AntiHookComponent`'s own override-point surface: the base class calls these as `this.<name>()`
/// internally, so a member with one of these names is not free to leave either. A name list rather
/// than a semantic override check, because resolving it properly would mean following the imported
/// base class into its own file — the cross-file resolution this crate deliberately stays out of.
/// A test below pins every name against the base class's own source, so a rename there fails here
/// instead of going stale.
const BASE_SURFACE_MEMBERS: [&str; 15] = [
    "useEffects",
    "unUseEffects",
    "useEffect",
    "useCarburetor",
    "connect",
    "connectSelection",
    "useComputed",
    "useResource",
    "track",
    "loadStaleResources",
    "releaseEffects",
    "onCarburetorUpdate",
    "commitSubscriptions",
    "releaseSubscriptions",
    "releaseConnectionViews",
];

/// The name a class member is declared under, private names included — a `#helper` method is as
/// much a member as a public one, and D1 gives it no separate treatment.
fn member_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::PrivateIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

/// Whether something this analysis cannot see calls the member by name: React, the component base,
/// or an interface contract. Visibility is not the boundary — extractability is.
fn framework_called(name: &str) -> bool {
    RENDER_METHODS.contains(&name)
        || REACT_CALLED_MEMBERS.contains(&name)
        || BASE_SURFACE_MEMBERS.contains(&name)
        || name.starts_with(UNSAFE_PREFIX)
}

/// Whether the capture survives the extraction the rule asks for.
///
/// Same predicate `require-method-for-closure` applies, and the same reasoning: a this-derived
/// capture is re-read from `this`, so its usage does not matter — but a class-independent closure
/// cannot have one, since a this-derived capture is a class dependency by definition. Any other
/// capture has to be a never-written local, and even then only a directly-called helper can take
/// one: a callback's captures freeze at closure creation, where a module-level function's
/// parameters would not.
fn passable(capture: &Capture<'_>, usage: &Usage<'_>) -> bool {
    capture.this_derived || matches!(usage, Usage::DirectHelper(_)) && !capture.written_after_init
}

/// The message for one class-independent closure: what the allocation costs, and where to put it.
fn closure_message(candidate: &Candidate<'_>, member: Option<&str>) -> String {
    let cadence = if candidate.executes_in_render {
        String::from("on every render")
    } else {
        match member {
            Some(name) => format!("on every call of `{name}`"),
            None => String::from("on every call"),
        }
    };

    // A class-independent closure cannot be a pure forwarder — `() => this.m()` uses the class —
    // so there is no forwarder variant here to keep dead.
    debug_assert!(candidate.forwarder.is_none());

    let plain: Vec<&str> = candidate.captures.iter().map(|capture| capture.name).collect();

    if plain.is_empty() {
        return format!(
            "this closure uses nothing from the class and is rebuilt {cadence} — declare it once \
             at module level."
        );
    }

    let count = if plain.len() > 1 { "parameters" } else { "a parameter" };
    let quoted = plain.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", ");

    format!(
        "this closure uses nothing from the class and is rebuilt {cadence} — declare it once at \
         module level, taking {quoted} as {count}."
    )
}

/// The message for one class-independent member, by what it costs: a function-valued field is
/// rebuilt once per instance, a plain prototype method for nothing — but both sit in the class
/// without needing it.
fn member_message(field_function: bool) -> String {
    if field_function {
        String::from(
            "this member is allocated once per instance but uses nothing from the class — declare \
             it once at module level, where one copy serves every instance.",
        )
    } else {
        String::from(
            "this method allocates nothing per instance but uses nothing from the class either — \
             it does not depend on the instance and belongs at module level.",
        )
    }
}

/// What one class needed to know across the walk: whether it is a component by the same-file
/// heritage walk (D6), and whether it declares an interface this crate cannot check.
#[derive(Clone, Copy)]
struct ClassFacts {
    component: bool,
    implements: bool,
}

/// One pass over one file: which of its classes are components, and the reports the members and
/// closures of those classes earn.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    /// The facts of each class in the file, keyed by the class's span — the only identity a class
    /// has across the walk's callbacks, and what keeps a nested class's answer from standing in
    /// for its enclosing one.
    classes: HashMap<Span, ClassFacts>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// The facts of the class the walk is in, when that class is one of this rule's own.
    fn facts(&self, context: &Context) -> Option<ClassFacts> {
        context
            .class_span
            .and_then(|span| self.classes.get(&span))
            .copied()
            .filter(|facts| facts.component)
    }

    /// Whether the member is `render`.
    fn is_render_key(key: &PropertyKey<'_>) -> bool {
        member_name(key).is_some_and(|name| RENDER_METHODS.contains(&name))
    }

    /// Reports the member's closures that need nothing from the class — the mirror image of
    /// `require-method-for-closure`'s condition, which takes the class-dependent ones.
    fn report_closures(&mut self, analysis: MemberAnalysis<'_>, context: &Context) {
        for candidate in analysis.closures {
            if candidate.class_dependency {
                continue;
            }

            if candidate.captures.iter().any(|capture| !passable(capture, &candidate.usage)) {
                continue;
            }

            let message = closure_message(&candidate, context.member.as_deref());

            self.diagnostics.push(report(self.source, candidate.span.start, RULE, message));
        }
    }

    /// Reports the method itself, when its signature and body need nothing from the class and
    /// nothing outside this analysis's reach calls it by name.
    fn report_method(
        &mut self,
        method: &MethodDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
    ) {
        if facts.implements {
            return;
        }

        // The core candidate condition: the signature and body must need nothing from the class.
        if class_dependency {
            return;
        }

        // Getters, setters and the constructor are called for; an ordinary method without a body
        // is a declaration (abstract, `declare`, an overload signature), not code to move.
        if method.kind != MethodDefinitionKind::Method {
            return;
        }

        if method.value.body.is_none() {
            return;
        }

        if method.r#override || method.computed || !method.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&method.key) else { return };

        if framework_called(name) {
            return;
        }

        let message = member_message(false);

        self.diagnostics.push(report(self.source, method.span.start, RULE, message));
    }

    /// The same for a class field, which is only a candidate when its value is a function.
    fn report_field(
        &mut self,
        property: &PropertyDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
    ) {
        if facts.implements {
            return;
        }

        if class_dependency {
            return;
        }

        let field_function = matches!(
            &property.value,
            Some(Expression::ArrowFunctionExpression(_)) | Some(Expression::FunctionExpression(_))
        );

        if !field_function {
            return;
        }

        if property.r#override || property.computed || !property.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&property.key) else { return };

        if framework_called(name) {
            return;
        }

        // A static field is built once per class rather than once per instance, so it takes the
        // plain prototype method's wording.
        let message = member_message(field_function && !property.r#static);

        self.diagnostics.push(report(self.source, property.span.start, RULE, message));
    }
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    /// `context.in_component` is direct-extends-only, but the allocation rules' scope is D6: a
    /// same-file subclass of a component counts, which only the semantic walk can see, so the
    /// answer is computed here and keyed by the class's span for the member callbacks to read.
    fn class(&mut self, class: &Class<'a>, _context: &Context) {
        let facts = ClassFacts {
            component: is_component_class(class, self.semantic),
            implements: !class.implements.is_empty(),
        };

        self.classes.insert(class.span, facts);
    }

    fn method(&mut self, method: &MethodDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else { return };

        // The walk's `in_render` needs a direct component base; a same-file subclass's render is
        // as much render code as the base's own, so the member name decides here as well.
        let member_is_render = context.in_render || Self::is_render_key(&method.key);

        let analysis = analyze_method(method, self.semantic, member_is_render);

        self.report_method(method, analysis.class_dependency, facts);
        self.report_closures(analysis, context);
    }

    fn property(&mut self, property: &PropertyDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else { return };

        let member_is_render = context.in_render || Self::is_render_key(&property.key);

        let analysis = analyze_field(property, self.semantic, member_is_render);

        self.report_field(property, analysis.class_dependency, facts);
        self.report_closures(analysis, context);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    walk_rule(
        program,
        Check {
            source,
            semantic: &semantic,
            classes: HashMap::new(),
            diagnostics: Vec::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::Path;

    use super::*;
    use crate::rules::support::testing::{diagnose, lines};
    use oxc_allocator::Allocator;
    use oxc_ast::AstKind;
    use oxc_ast::ast::ClassElement;
    use oxc_ast_visit::Visit;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn reported(source: &str) -> Vec<Diagnostic> {
        diagnose(source, check)
    }

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
        assert!(message.contains("declare it once at module level"), "{message}");
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

        assert!(message.contains("rebuilt on every call of `method`"), "{message}");
        assert!(message.contains("taking `suffix` as a parameter"), "{message}");
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

        assert!(message.contains("allocates nothing per instance"), "{message}");
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

        assert_eq!(lines(&reported(source)), [3]);
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

        assert_eq!(lines(&reported(source)), [3]);
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
    fn every_base_surface_name_is_still_declared_on_antihookcomponent_itself() {
        let path = Path::new("../lib/src/Carburetor/Component/AntiHookComponent.tsx");
        let text = std::fs::read_to_string(path).expect(
            "the component base class source sits at lib/src/Carburetor/Component/\
             AntiHookComponent.tsx, relative to native/",
        );

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "the base class must parse: {:?}",
            parsed.diagnostics
        );

        // The base class is declared under `export`, so the classes are collected by node kind
        // rather than by statement shape.
        struct Classes<'a>(Vec<&'a Class<'a>>);

        impl<'a> Visit<'a> for Classes<'a> {
            fn enter_node(&mut self, kind: AstKind<'a>) {
                if let AstKind::Class(class) = kind {
                    self.0.push(class);
                }
            }
        }

        let mut classes = Classes(Vec::new());
        classes.visit_program(&parsed.program);

        let mut declared = HashSet::new();

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

        for name in BASE_SURFACE_MEMBERS {
            assert!(
                declared.contains(name),
                "{name} is on the base-surface list but no longer declared on \
                 AntiHookComponent — update the list"
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

        assert_eq!(lines(&reported(source)), [4]);
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
        assert!(message.contains("declare it once at module level"), "{message}");
        assert!(!message.contains("allocates nothing per instance"), "{message}");
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
        assert!(found[0].message.contains("belongs at module level"), "{}", found[0].message);
    }

    #[test]
    fn closures_inside_an_arrow_field_are_not_collected_just_as_the_method_rule_does_not() {
        // The field itself is the report here; its inner closure stays uncollected, the same
        // boundary `require-method-for-closure` already works within.
        let source = r#"
class Widget extends AntiHookComponent {
    handler = () => {
        return [1].map((x) => x * 2);
    };
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [3]);
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
}
