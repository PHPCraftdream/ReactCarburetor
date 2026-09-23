//! H28: a closure inside a component's member that the class could own as a method.
//!
//! Every call of the member builds the closure again — every render, when the member is `render` —
//! an allocation the class does not need: what the closure reads is either already on `this` or a
//! local a method parameter could carry. Nothing breaks; the engine just builds a function object
//! per call that a declared method would build once. The rule reports the closures whose rewrite
//! leaves no per-call allocation behind and says how to declare the method: re-read the
//! this-derived values from `this` inside it, take the plain locals as parameters, and decorate it
//! with `@bind` when the closure is handed somewhere as a value.
//!
//! A plain local captured by a callback blocks the report — passing it by value would freeze a
//! value that is supposed to change — and so does a closure that writes one. A closure that is
//! nothing but a forward to a method gets shorter advice: pass the method itself, bound once.
//! See docs/hazards.md, H28.

use std::collections::HashMap;

use oxc_ast::ast::{Class, MethodDefinition, Program, PropertyDefinition, PropertyKey};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::closures::{
    analyze_field, analyze_method, build_semantic, is_component_class, Candidate, Capture,
    MemberAnalysis, Usage,
};
use crate::rules::support::names::property_key_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-method-for-closure";

/// Whether the capture survives the extraction the rule asks for.
///
/// A this-derived capture is re-read from `this` inside the method, so its usage does not matter.
/// Any other capture has to be a never-written local, and even then only a directly-called helper
/// can take one: a callback's captures freeze at closure creation, where a method's parameters
/// would not.
fn passable(capture: &Capture<'_>, usage: &Usage<'_>) -> bool {
    capture.this_derived || matches!(usage, Usage::DirectHelper(_)) && !capture.written_after_init
}

/// The message for one reportable closure: what the allocation costs, and what to declare instead.
fn message(candidate: &Candidate<'_>, member: Option<&str>) -> String {
    let cadence = if candidate.executes_in_render {
        String::from("on every render")
    } else {
        match member {
            Some(name) => format!("on every call of `{name}`"),
            None => String::from("on every call"),
        }
    };

    // A pure forwarder's rewrite is smaller than an extraction: the method it already calls goes
    // where the closure is, bound once, instead of the wrapper being built once per call.
    if let Some(forwarder) = &candidate.forwarder {
        return format!(
            "this closure is rebuilt {cadence} doing nothing but forwarding to `this.{}` — pass \
             `this.{}` directly, bound once with @bind, instead of allocating the wrapper.",
            forwarder.method, forwarder.method
        );
    }

    let quoted = |names: &[&str]| {
        names.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", ")
    };

    let this_derived: Vec<&str> = candidate
        .captures
        .iter()
        .filter(|capture| capture.this_derived)
        .map(|capture| capture.name)
        .collect();

    let plain: Vec<&str> = candidate
        .captures
        .iter()
        .filter(|capture| !capture.this_derived)
        .map(|capture| capture.name)
        .collect();

    let mut rewrite = String::from("Declare it as a method");

    if matches!(candidate.usage, Usage::Callback) {
        rewrite.push_str(", decorated with @bind because it is handed over as a value");
    }

    if !this_derived.is_empty() {
        rewrite.push_str(&format!(", reading {} from `this` inside it", quoted(&this_derived)));
    }

    if !plain.is_empty() {
        let count = if plain.len() > 1 { "parameters" } else { "a parameter" };

        rewrite.push_str(&format!(" and taking {} as {count}", quoted(&plain)));
    }

    rewrite.push('.');

    format!(
        "this closure is rebuilt {cadence} — an allocation the class does not need, since \
         everything it uses is on `this` or can be passed in. {rewrite}"
    )
}

/// One pass over one file: which of its classes are components, and the reports the members of
/// those classes earn.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    /// Whether each class in the file is a component, keyed by the class's span — the only
    /// identity a class has across the walk's callbacks, and what keeps a nested class's answer
    /// from standing in for its enclosing one.
    components: HashMap<Span, bool>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// Whether the class the walk is in is a component, by the same-file heritage walk (D6).
    fn component(&self, context: &Context) -> bool {
        context
            .class_span
            .and_then(|span| self.components.get(&span))
            .copied()
            .unwrap_or(false)
    }

    /// Whether the member is `render`.
    fn is_render_key(key: &PropertyKey<'_>) -> bool {
        property_key_name(key).is_some_and(|name| RENDER_METHODS.contains(&name))
    }

    /// Reports the member's candidates whose extraction leaves no per-call allocation behind.
    fn report_member(&mut self, analysis: MemberAnalysis<'_>, context: &Context) {
        for candidate in analysis.closures {
            if !candidate.class_dependency {
                continue;
            }

            if candidate.captures.iter().any(|capture| !passable(capture, &candidate.usage)) {
                continue;
            }

            let message = message(&candidate, context.member.as_deref());

            self.diagnostics.push(report(self.source, candidate.span.start, RULE, message));
        }
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
        let component = is_component_class(class, self.semantic);

        self.components.insert(class.span, component);
    }

    fn method(&mut self, method: &MethodDefinition<'a>, context: &Context) {
        if !self.component(context) {
            return;
        }

        // The walk's `in_render` needs a direct component base; a same-file subclass's render is
        // as much render code as the base's own, so the member name decides here as well.
        let member_is_render = context.in_render || Self::is_render_key(&method.key);

        self.report_member(analyze_method(method, self.semantic, member_is_render), context);
    }

    fn property(&mut self, property: &PropertyDefinition<'a>, context: &Context) {
        if !self.component(context) {
            return;
        }

        let member_is_render = context.in_render || Self::is_render_key(&property.key);

        self.report_member(analyze_field(property, self.semantic, member_is_render), context);
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
            components: HashMap::new(),
            diagnostics: Vec::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    fn reported(source: &str) -> Vec<Diagnostic> {
        diagnose(source, check)
    }

    #[test]
    fn the_todo_app_shape_is_reported_on_every_render_with_its_this_derived_capture_named() {
        let source = r#"
const TodoItem = (props: { key: string; carburetor: number; id: number }) => null;

class TodoApp extends AntiHookComponent {
    render() {
        const { carburetor } = this.props as { carburetor: number };

        return this.orderIds.map((id) => <TodoItem key={id} carburetor={carburetor} id={id}/>);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [8]);

        let message = &found[0].message;

        assert!(message.contains("rebuilt on every render"), "{message}");
        assert!(message.contains("reading `carburetor` from `this` inside it"), "{message}");
        assert!(message.contains("@bind because it is handed over as a value"), "{message}");
    }

    #[test]
    fn a_plain_local_captured_by_a_callback_blocks_the_report() {
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
    fn a_plain_local_captured_by_a_class_dependent_callback_is_never_passable() {
        // The plain local makes the capture impassable in a callback's usage; the `this.mark`
        // read only makes the closure class-dependent, so the passability gate is what blocks.
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        return <ul>{this.items.map((item) => <li key={item}>{suffix}{this.mark}</li>)}</ul>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_direct_helper_over_a_never_written_const_takes_it_as_a_parameter() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        const label = (name: string) => this.base + name + suffix;

        return label(this.title);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [6]);

        let message = &found[0].message;

        assert!(message.contains("rebuilt on every call of `render`"), "{message}");
        assert!(message.contains("taking `suffix` as a parameter"), "{message}");
        assert!(!message.contains("@bind"), "{message}");
    }

    #[test]
    fn a_direct_helper_over_a_local_reassigned_later_is_not_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    method(flag: boolean) {
        let suffix = "!";
        const label = (name: string) => this.base + name + suffix;

        if (flag) {
            suffix = "?";
        }

        return label("done");
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_closure_that_writes_its_own_capture_is_not_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    method() {
        let count = 0;
        const bump = () => {
            count += 1;

            return this.show(count);
        };

        return bump();
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_pure_forwarder_gets_the_forwarder_message() {
        let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const forward = (a: number, b: string) => this.handle(a, b);

        return this.transport(forward);
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [4]);

        let message = &found[0].message;

        assert!(message.contains("forwarding to `this.handle`"), "{message}");
        assert!(message.contains("bound once with @bind"), "{message}");
        assert!(!message.contains("Declare it as a method"), "{message}");
    }

    #[test]
    fn a_forwarder_with_a_plain_local_argument_is_not_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const item = this.pick();
        const forward = (a: number) => this.handle(item, a);

        return this.transport(forward);
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_closure_on_a_component_element_is_h21s_not_this_rules() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return <Row onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_dom_element_attribute_using_this_is_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        let found = reported(source);

        assert_eq!(lines(&found), [4]);

        let message = &found[0].message;

        assert!(message.contains("on every call of `render`"), "{message}");
        // `() => this.handle()` is the plan §5.5's first forwarder shape — zero parameters
        // forwarded to a `this.` call — so the advice is the forwarder one: pass the bound
        // method instead of building the wrapper.
        assert!(message.contains("on every call of `render`"), "{message}");
        assert!(message.contains("forwarding to `this.handle`"), "{message}");
        assert!(message.contains("bound once with @bind"), "{message}");
        assert!(!message.contains("Declare it as a method"), "{message}");
    }

    #[test]
    fn library_callback_apis_keep_their_closures_where_they_sit() {
        let source = r#"
class Widget extends AntiHookComponent {
    componentDidMount() {
        useEffect(() => this.subscribe());
        update((draft) => this.touch(draft));
        transaction(() => this.commit());
        computed(() => this.read());
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn render_closures_calling_the_tracked_apis_are_not_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        this.rows.forEach((row) => this.getData(row));

        return [1].map(() => this.useCarburetor());
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_tracked_call_outside_render_is_this_rules_report_to_make() {
        // The tracked-API exclusion is render-only by design: outside render, moving the call
        // cannot hide it from a rule that reads it today, so a class-dependent closure with
        // nothing but `this` inside is a normal candidate.
        let source = r#"
class Widget extends AntiHookComponent {
    list() {
        return [1].map(() => this.useCarburetor());
    }
}
"#;

        assert_eq!(lines(&reported(source)), [4]);
    }

    #[test]
    fn a_class_field_initializer_closure_is_not_reported() {
        let source = r#"
class Widget extends AntiHookComponent {
    onClick = () => {
        const inner = () => this.handle();

        return inner;
    };
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_closure_assigned_to_this_is_a_member_in_all_but_syntax() {
        let source = r#"
class Widget extends AntiHookComponent {
    constructor() {
        this.onClick = () => this.handle();
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_function_expression_using_this_has_a_this_of_its_own() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = function () {
            return this.value;
        };

        return handler;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn an_arrow_using_arguments_cannot_be_passed_transparently() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = () => arguments.length;

        return handler;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_nested_class_is_reported_once_as_its_own_class() {
        let source = r#"
class Outer extends AntiHookComponent {
    render() {
        return <button onClick={() => this.handle()}/>;
    }

    make() {
        return class Nested extends AntiHookComponent {
            render() {
                return <button onClick={() => this.click()}/>;
            }
        };
    }
}
"#;

        assert_eq!(lines(&reported(source)), [4, 10]);
    }

    #[test]
    fn a_nested_component_inside_a_plain_class_is_still_the_only_one_reported() {
        let source = r#"
class Plain {
    make() {
        return class Nested extends AntiHookComponent {
            render() {
                return <button onClick={() => this.click()}/>;
            }
        };
    }
}
"#;

        assert_eq!(lines(&reported(source)), [6]);
    }

    #[test]
    fn a_store_class_and_its_subclass_are_out_of_scope() {
        let source = r#"
class MyStore extends Carburetor {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}

class SubStore extends MyStore {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_same_file_subclass_of_a_component_subclass_is_a_component() {
        let source = r#"
class Ground extends AntiHookComponent {}

class Middle extends Ground {}

class Top extends Middle {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [8]);
    }

    #[test]
    fn a_subclass_of_an_imported_base_is_outside_the_same_file_walk() {
        let source = r#"
import { External } from "./external";

class Widget extends External {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_same_file_subclass_render_stays_render_for_the_tracked_api_exclusion() {
        // `context.in_render` from the walk is direct-extends-only; without the rule widening it
        // to D6's scope, this closure would come back as a candidate — class-dependent, zero
        // captures — and the report would move a `getData` call out of render.
        let source = r#"
class Ground extends AntiHookComponent {}

class Top extends Ground {
    render() {
        return this.rows.map((row) => this.getData(row));
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_that_is_not_a_component_is_left_alone() {
        let source = r#"
class Plain {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

        assert_eq!(lines(&reported(source)), [] as [usize; 0]);
    }
}
