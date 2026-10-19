//! H2: a computed read with `get()` while a component renders.
//!
//! `get()` returns the memoized value and registers no subscription, so the component never hears
//! that the derived value changed — the same silent freeze as reading a store with `getData()`.
//!
//! A computed's `get()` takes no arguments, which is what tells it apart from `Map.get(key)`,
//! `FormData.get(name)` and every other `get` that needs a key. A zero-argument `get()` on
//! something that is not a computed is this rule's only false positive, and it is rare in render.
//! See docs/hazards.md, H2.

use oxc_ast::ast::{CallExpression, Program};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, RenderKind, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-computed-get-in-render";

const CLASS_MESSAGE: &str =
    "get() in render returns the derived value without subscribing to it, so this \
    component will not re-render when it changes. Use this.useComputed(computed), which subscribes \
    to the value rather than to its inputs.";

const FUNCTION_MESSAGE: &str =
    "get() in render returns the derived value without subscribing to it, so this \
    component will not re-render when it changes. Use useComputedValue(computed), which subscribes \
    to the value rather than to its inputs.";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut self.diagnostics)
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        // A keyed lookup is somebody else's `get`, not a computed's.
        if !context.in_render || !call.arguments.is_empty() {
            return;
        }

        if member_call_name(&call.callee) != Some("get") {
            return;
        }

        let message = match context.render_kind {
            Some(RenderKind::Function) => FUNCTION_MESSAGE,
            _ => CLASS_MESSAGE,
        };
        self.diagnostics.push(report(
            self.source,
            call.span.start,
            RULE,
            message.to_string(),
        ));
    }
}

/// Builds this rule's state without traversing the program.
pub(in crate::rules) fn make_rule<'a, 's>(source: &'s Source<'s>) -> impl Rule<'a> + 's {
    Check { source, diagnostics: Vec::new() }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, bases: &Bases) -> Vec<Diagnostic> {
    walk_rule(program, make_rule(source), bases)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_zero_argument_get_in_render_is_reported() {
        let source = "class Widget extends AntiHookComponent {
    render() {
                              return <b>{visibleCount.get()}</b>;
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_keyed_get_in_render_is_somebodys_else_get() {
        // `Map.get(key)` takes an argument; a computed's `get()` does not, and that is the only
        // thing separating them without type information.
        let source = "class Widget extends AntiHookComponent {
    render() {
                              return <b>{map.get(key)}</b>;
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_get_inside_a_handler_is_not_render_code() {
        let source = "class Widget extends AntiHookComponent {
    render() {
                              return <button onClick={() => visibleCount.get()}>go</button>;
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_get_outside_render_is_fine() {
        let source = "class Widget extends AntiHookComponent {
    componentDidMount() {
                              visibleCount.get();
    }
    render() { return null; }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_get_in_a_plain_class_is_not_render_code() {
        let source = "class Widget {
    render() {
        return visibleCount.get();
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_zero_argument_get_in_a_function_component_is_reported() {
        let source = "function Row() {
    return <b>{visibleCount.get()}</b>;
}
";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }
}
