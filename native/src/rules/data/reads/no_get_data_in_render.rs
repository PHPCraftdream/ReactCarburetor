//! H1: `getData()` called while a component renders.
//!
//! `getData()` returns the raw state and records nothing, so the component never subscribes: it
//! renders the right value once and then stays frozen. No error, no warning — just a number that
//! stops moving. Outside render `getData()` is the correct call, which is why this is scoped to the
//! render method rather than to the class. See docs/hazards.md, H1.

use oxc_ast::ast::{CallExpression, Program};

use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::rules::report;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-get-data-in-render";

const MESSAGE: &str = "getData() in render reads the state without subscribing to it, so this \
    component will never re-render when the data changes. Read through \
    this.useCarburetor(carburetor) instead, which subscribes to exactly the fields you read.";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        if !context.in_render || member_call_name(&call.callee) != Some("getData") {
            return;
        }

        self.diagnostics.push(report(self.source, call.span.start, RULE, MESSAGE.to_string()));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a class body in a component, so each test reads as the code it is about.
    fn component(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n{body}\n}}\n")
    }

    #[test]
    fn a_read_in_render_is_reported() {
        let source = component("    render() {\n        return this.store.getData().x;\n    }");

        // Line 3: the wrapper contributes the class line and the method line.
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_read_in_a_handler_written_in_render_is_not() {
        // The handler runs after the commit, where getData() is the correct call.
        let source = component(
            "    render() {\n        return <b onClick={() => this.store.getData()}/>;\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_read_in_a_map_callback_is_reported() {
        // `map` runs its callback while the expression evaluates, so that body is render code.
        let source = component(
            "    render() {\n        return this.ids.map((id) => this.store.getData()[id]);\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_read_outside_render_is_not_reported() {
        let source = component("    save() {\n        return this.store.getData();\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn render_written_as_a_class_property_still_counts() {
        let source = component("    render = () => {\n        return this.store.getData();\n    };");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_class_that_is_not_a_component_is_left_alone() {
        let source = "class Plain {\n    render() {\n        return this.store.getData();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn module_level_code_is_left_alone() {
        assert_eq!(lines(&diagnose("const x = store.getData();\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn a_nested_class_does_not_inherit_render() {
        // The inner class's render is not a component's render, and the outer one has ended.
        let source = component(
            "    render() {\n        class Inner {\n            render() {\n                \
             return this.store.getData();\n            }\n        }\n\n        return Inner;\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_namespaced_base_class_is_recognised() {
        let source = "class Widget extends carburetor.AntiHookComponent {\n    render() {\n        \
                      return this.store.getData();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }
}
