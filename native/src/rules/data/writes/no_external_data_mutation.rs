//! H8: a mutation of what `getData()` returned.
//!
//! `getData()` hands out the live state. Writing through it records no path *and* never reaches
//! `emitUpdate`, so the state and the screen disagree until something unrelated happens to wake the
//! same subscribers. Snapshots taken earlier drift too, because they share the object that was just
//! edited, which makes undo restore a state that never existed. State changes belong to the store
//! that owns the state: add a method there and write through `draft`. See docs/hazards.md, H8.

use oxc_ast::ast::Program;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::chain::ChainRoot;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-external-data-mutation";

/// Calls that hand out live state rather than a copy of it.
///
/// `getEntry` returns a fresh view object, but the `data` inside it is the very object every reader
/// of that cache entry sees, so writing through it has the same consequences as `getData()`.
const STATE_READERS: [&str; 2] = ["getData", "getEntry"];

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn mutation(&mut self, root: &ChainRoot<'_, 'a>, span: Span, _context: &Context) {
        let Some(call) = root.call() else {
            return;
        };

        let Some(reader) = member_call_name(&call.callee) else {
            return;
        };

        if !STATE_READERS.contains(&reader) {
            return;
        }

        let message = format!(
            "mutating what {reader}() returned changes the state without recording a path and \
             without notifying anyone, so nothing re-renders and any snapshot taken earlier silently \
             changes with it. Add a method to the carburetor and write through draft there."
        );

        self.diagnostics.push(report(self.source, span.start, RULE, message));
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
    fn a_write_through_get_data_is_reported() {
        assert_eq!(lines(&diagnose("store.getData().items[id] = todo;\n", check)), [1]);
    }

    #[test]
    fn a_push_through_get_data_is_reported() {
        assert_eq!(lines(&diagnose("store.getData().orderIds.push(id);\n", check)), [1]);
    }

    #[test]
    fn a_write_through_get_entry_is_reported() {
        assert_eq!(lines(&diagnose("cache.getEntry(args).data.x = 1;\n", check)), [1]);
    }

    #[test]
    fn reading_is_not_mutating() {
        assert_eq!(lines(&diagnose("const x = store.getData().items;\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn a_write_through_another_call_is_left_alone() {
        assert_eq!(lines(&diagnose("buildDraft().items[id] = todo;\n", check)), [] as [usize; 0]);
    }
}
