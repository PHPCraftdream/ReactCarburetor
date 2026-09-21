//! H4: `useCarburetor` or `useComputed` called anywhere but render.
//!
//! Reads are collected into the tracking set of the render currently in progress, and the carburetor
//! copies that set when the component commits. A read from a handler, an effect or the constructor
//! therefore either does nothing at all or widens a subscription that the next render throws away —
//! non-deterministically, depending on when the code happened to run. In a handler `getData()` is
//! the right call: nothing there needs a subscription. See docs/hazards.md, H4.

use oxc_ast::ast::{CallExpression, Program};

use crate::rules::report;
use crate::rules::support::names::{called_on_this, member_call_name};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-use-carburetor-outside-render";

/// The reads that only mean anything during a render.
const TRACKING_READS: [&str; 2] = ["useCarburetor", "useComputed"];

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        // Only inside a component, and only where a render is not in progress.
        if context.in_render || !context.in_component || !called_on_this(&call.callee) {
            return;
        }

        let Some(name) = member_call_name(&call.callee) else {
            return;
        };

        if !TRACKING_READS.contains(&name) {
            return;
        }

        let message = format!(
            "this.{name}() outside render does not establish a subscription: reads are collected \
             per render and copied when the component commits, so this one is either ignored or \
             discarded by the next render. Read in render, and use getData() where no subscription \
             is wanted."
        );

        self.diagnostics.push(report(self.source, call.span.start, RULE, message));
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

    #[test]
    fn a_tracking_read_in_a_handler_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    save() {\n        \
                      const data = this.useCarburetor(store);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_tracking_read_in_render_is_correct() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      return this.useCarburetor(store).x;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_read_created_in_render_but_run_later_is_reported() {
        // The handler body is not render code, so the read there is the hazard, in render or not.
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      return <b onClick={() => this.useCarburetor(store)}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn the_same_call_outside_a_component_is_not_this_rules_business() {
        let source = "class Plain {\n    save() {\n        this.useCarburetor(store);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_similarly_named_call_on_something_else_is_left_alone() {
        let source = "class Widget extends AntiHookComponent {\n    save() {\n        \
                      helper.useCarburetor(store);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
