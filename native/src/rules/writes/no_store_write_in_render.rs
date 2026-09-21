//! H11: a call that changes a store while a component renders.
//!
//! With the default scheduler the write notifies subscribers during the render. In the lucky case
//! that costs an extra pass; in the unlucky one React reports a maximum-update-depth error far from
//! the cause, or an abandoned concurrent render has already changed the state other components see.
//! Writes belong in `useEffects`, in a handler, or in a resource load.
//!
//! A store is identified by evidence rather than by a naming convention: whatever is passed to
//! `this.useCarburetor(...)` or `this.useComputed(...)` anywhere in the file is one, compared by the
//! source text of that argument so `this.props.carburetor` works as well as an imported singleton.
//! A component that writes to a store it never reads is not detected. See docs/hazards.md, H11.

use std::collections::HashSet;

use oxc_ast::ast::{CallExpression, Expression, Program};
use oxc_span::GetSpan;

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-store-write-in-render";

/// Calls that only read, and are therefore fine in render.
const READ_METHODS: [&str; 9] = [
    "getData",
    "getVersion",
    "getUID",
    "getLastError",
    "snapshot",
    "toJSON",
    "read",
    "get",
    // `suspend()` does write — it starts the request and marks the resource pending — but it is
    // built for exactly this position: the notification is deferred to a microtask precisely
    // because a render must not notify. Reporting it would flag the documented way to use Suspense.
    "suspend",
];

/// Reads that identify their argument as a store or a computed.
const TRACKING_READS: [&str; 2] = ["useCarburetor", "useComputed"];

/// A write in render, waiting to be judged once the file has revealed what its stores are.
struct Suspect {
    offset: u32,
    receiver: String,
    method: String,
}

struct Check<'s> {
    source: &'s Source<'s>,
    /// The source text of everything read as a store anywhere in this file.
    stores: HashSet<String>,
    suspects: Vec<Suspect>,
}

impl<'s> Check<'s> {
    /// The source text a span covers, which is how a receiver is compared to a store.
    fn text(&self, start: u32, end: u32) -> String {
        self.source.text[start as usize..end as usize].to_string()
    }
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.suspects
            .iter()
            .filter(|suspect| self.stores.contains(&suspect.receiver))
            .map(|suspect| {
                let message = format!(
                    "{}() changes a store while this component renders, which notifies subscribers \
                     mid-render: at best an extra pass, at worst an update loop React reports far \
                     from here. Write from useEffects, from an event handler, or from a resource \
                     load.",
                    suspect.method
                );

                report(self.source, suspect.offset, RULE, message)
            })
            .collect()
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        let Some(method) = member_call_name(&call.callee) else {
            return;
        };

        // Whatever is read as a store is a store, wherever in the file that read happens.
        if TRACKING_READS.contains(&method) {
            if let Some(source) = call.arguments.first().and_then(|argument| argument.as_expression())
            {
                let span = source.span();

                self.stores.insert(self.text(span.start, span.end));
            }

            return;
        }

        if READ_METHODS.contains(&method) || !context.in_render {
            return;
        }

        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return;
        };

        let span = callee.object.span();

        self.suspects.push(Suspect {
            offset: call.span.start,
            receiver: self.text(span.start, span.end),
            method: method.to_string(),
        });
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, stores: HashSet::new(), suspects: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_write_to_a_store_read_in_render_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        store.rename('x');\n        \
                      return d.name;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_read_only_call_is_fine_in_render() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        return store.snapshot();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn suspend_is_built_for_render() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(resource);\n        return resource.suspend(1);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_write_from_a_handler_is_where_writes_belong() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        \
                      return <b onClick={() => store.rename('x')}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_receiver_that_was_never_read_as_a_store_is_not_one() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      logger.write('x');\n        return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_store_reached_through_props_is_compared_by_its_text() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(this.props.carburetor);\n        \
                      this.props.carburetor.rename('x');\n        return d.name;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_store_read_elsewhere_in_the_file_still_counts() {
        // The evidence does not have to be in the same component: one read anywhere names the store.
        let source = "class Reader extends AntiHookComponent {\n    render() {\n        \
                      return this.useCarburetor(store).name;\n    }\n}\n\n\
                      class Writer extends AntiHookComponent {\n    render() {\n        \
                      store.rename('x');\n        return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [9]);
    }
}
