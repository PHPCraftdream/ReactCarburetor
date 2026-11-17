//! A component that watches a store by hand where `useStoreEffect` would.
//!
//! A `watch(select, onChange)` on a store, or `watch(onChange)` on a computed, started inside a
//! `this.useEffect` callback or in `componentDidMount`, is the code `useStoreEffect` replaces: the
//! component has to run the effect once for the current value itself, keep the disposer, and order
//! the run's cleanup against the watch's. `useStoreEffect(name, store, select, effect)` (or
//! `(name, computed, effect)`) does all three. Calls on `this` (a store watching itself) and
//! arguments that cannot be callbacks (`fs.watch('dir')`) are not reported.
//!
//! `storeEffect(store, select, effect)` started the same way is reported too: it is
//! `useStoreEffect` without the component's bookkeeping. And a `storeEffect` or `watch` started in
//! `render` subscribes again on every render, so it is reported with that reason.

use oxc_ast::ast::{
    Argument, CallExpression, Class, ClassElement, Expression, Function, MethodDefinition, Program,
};
use oxc_ast_visit::{walk, Visit};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::{called_on_this, member_call_name, property_key_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/prefer-store-effect";

const MESSAGE: &str = "this component watches a store by hand: it has to run the effect for the \
    current value itself, keep the disposer and order the cleanups. \
    this.useStoreEffect(name, store, select, effect), or (name, computed, effect), does all of \
    that inside useEffects.";

/// Whether an argument can be a callback: a function, or a name or member that may hold one.
fn callback_like(argument: &Argument<'_>) -> bool {
    matches!(
        argument,
        Argument::ArrowFunctionExpression(_)
            | Argument::FunctionExpression(_)
            | Argument::Identifier(_)
            | Argument::StaticMemberExpression(_)
            | Argument::CallExpression(_)
    )
}

const RENDER_MESSAGE: &str = "this subscription starts in render, so every render adds another one and none is ever stopped. this.useStoreEffect(name, store, select, effect) in useEffects follows the store once, for the component's lifetime.";

/// Whether a call is `storeEffect(store, select, effect)` or `storeEffect(computed, effect)`.
fn is_store_effect(call: &CallExpression<'_>) -> bool {
    let named = match &call.callee {
        Expression::Identifier(identifier) => identifier.name == "storeEffect",
        callee => member_call_name(callee) == Some("storeEffect") && !called_on_this(callee),
    };

    named && matches!(call.arguments.len(), 2 | 3)
}

/// Whether a call is a store's `watch(select, onChange)` or a computed's `watch(onChange)`.
fn is_store_watch(call: &CallExpression<'_>) -> bool {
    if member_call_name(&call.callee) != Some("watch") || called_on_this(&call.callee) {
        return false;
    }

    match call.arguments.as_slice() {
        [only] => callback_like(only),
        [select, on_change] => callback_like(select) && callback_like(on_change),
        _ => false,
    }
}

/// The watches inside one effect body, one `componentDidMount` or one `render`.
struct Watches<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    message: &'static str,
}

impl<'a> Visit<'a> for Watches<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if is_store_watch(call) || is_store_effect(call) {
            self.diagnostics.push(report(
                self.source,
                call.span.start,
                RULE,
                self.message.to_string(),
            ));
        }

        walk::walk_call_expression(self, call);
    }

    // A class declared inside has a component, or a store, of its own.
    fn visit_class(&mut self, _class: &Class<'a>) {}
}

/// One pass over one file: effect callbacks handed to `this.useEffect`, and `componentDidMount`.
struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl Check<'_> {
    fn scan_argument(&mut self, argument: &Argument<'_>) {
        let mut watches = Watches {
            source: self.source,
            diagnostics: Vec::new(),
            message: MESSAGE,
        };

        match argument {
            Argument::ArrowFunctionExpression(arrow) => {
                watches.visit_arrow_function_expression(arrow)
            }
            Argument::FunctionExpression(function) => {
                if let Some(body) = &function.body {
                    watches.visit_function_body(body);
                }
            }
            _ => {}
        }
        self.diagnostics.append(&mut watches.diagnostics);
    }

    fn scan_function(&mut self, function: &Function<'_>, message: &'static str) {
        if let Some(body) = &function.body {
            let mut watches = Watches {
                source: self.source,
                diagnostics: Vec::new(),
                message,
            };

            watches.visit_function_body(body);
            self.diagnostics.append(&mut watches.diagnostics);
        }
    }
}

impl<'a> Visit<'a> for Check<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) == Some("useEffect") && called_on_this(&call.callee) {
            // `useEffect(name, body, deps)` or `useEffect(effect, deps)`.
            let body = if call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|first| matches!(first, Expression::StringLiteral(_)))
            {
                call.arguments.get(1)
            } else {
                call.arguments.first()
            };

            if let Some(body) = body {
                self.scan_argument(body);
            }

            return;
        }

        walk::walk_call_expression(self, call);
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        if class.heritage.is_some() {
            for element in &class.body.body {
                if let ClassElement::MethodDefinition(method) = element {
                    self.inspect_method(method);
                }
            }
        }

        walk::walk_class(self, class);
    }
}

impl Check<'_> {
    fn inspect_method(&mut self, method: &MethodDefinition<'_>) {
        match property_key_name(&method.key) {
            Some("componentDidMount") => self.scan_function(&method.value, MESSAGE),
            Some("render") => self.scan_function(&method.value, RENDER_MESSAGE),
            _ => {}
        }
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>, _bases: &Bases) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        diagnostics: Vec::new(),
    };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_watch_inside_an_effect_callback_is_reported() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    useEffects() {\n",
            "        this.useEffect('theme', () => settings.watch(selectTheme, applyTheme), [settings]);\n",
            "        this.useEffect(() => { return this.props.total.watch(show); }, []);\n",
            "    }\n",
            "}\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [3, 4]);
    }

    #[test]
    fn a_store_effect_inside_an_effect_or_component_did_mount_is_reported() {
        let source = concat!(
            "class A extends AntiHookComponent {
",
            "    useEffects() {
",
            "        this.useEffect('theme', () => storeEffect(settings, selectTheme, applyTheme), [settings]);
",
            "    }
",
            "    componentDidMount() {
",
            "        super.componentDidMount();
",
            "        this.stop = Engine.storeEffect(this.props.total, show);
",
            "    }
",
            "}
",
        );

        assert_eq!(lines(&diagnose(source, check)), [3, 7]);
    }

    #[test]
    fn a_subscription_started_in_render_is_reported_with_its_own_reason() {
        let source = concat!(
            "class A extends AntiHookComponent {
",
            "    render() {
",
            "        this.stop = storeEffect(settings, selectTheme, applyTheme);
",
            "        settings.watch(selectTheme, applyTheme);
",
            "        const items = list.map((item) => item.name);
",
            "        return <div>{items}</div>;
",
            "    }
",
            "}
",
        );
        let found = diagnose(source, check);

        assert_eq!(lines(&found), [3, 4]);
        assert!(found[0].message.contains("starts in render"));
    }

    #[test]
    fn a_store_effect_outside_components_is_not_this_rules_business() {
        let source = "export const stop = storeEffect(settings, selectTheme, applyTheme);
";

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn a_watch_in_component_did_mount_is_reported() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    componentDidMount() {\n",
            "        super.componentDidMount();\n",
            "        this.stop = this.props.store.watch((s) => s.title, (title) => log(title));\n",
            "    }\n",
            "}\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn use_store_effect_a_store_watching_itself_and_non_callbacks_are_fine() {
        let source = concat!(
            "class A extends AntiHookComponent {\n",
            "    useEffects() {\n",
            "        this.useStoreEffect('theme', settings, selectTheme, applyTheme);\n",
            "        this.useEffect('files', () => fs.watch('dir'), []);\n",
            "    }\n",
            "}\n",
            "class S extends Carburetor {\n",
            "    componentDidMount() { this.watch(selectA, onA); }\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn a_watch_outside_effects_and_did_mount_is_not_this_rule() {
        let source = concat!(
            "const stop = store.watch(selectA, onA);\n",
            "class A extends AntiHookComponent {\n",
            "    handle() { this.stop = store.watch(selectA, onA); }\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }
}
