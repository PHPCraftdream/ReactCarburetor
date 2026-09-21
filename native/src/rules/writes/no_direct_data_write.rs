//! H7: a store writing straight to `this.data`.
//!
//! It works — and quietly costs the whole point of the library. No path is recorded, so
//! `emitUpdate` cannot know what changed and falls back to invalidating everything: every
//! subscriber of the store re-renders. Nothing breaks, the app just gets slow in the way a
//! hooks-based one does, and the cause is invisible in a profiler trace. See docs/hazards.md, H7.

use oxc_ast::ast::Program;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::chain::ChainRoot;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-direct-data-write";

const MESSAGE: &str = "writing to this.data records no path, so this update invalidates the whole \
    store and re-renders every subscriber instead of the ones that read what changed. Write through \
    this.draft, or this.update(draft => ...) to mutate and publish in one step.";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn mutation(&mut self, root: &ChainRoot<'_, 'a>, span: Span, context: &Context) {
        if !context.in_carburetor || !root.is_this_property("data") {
            return;
        }

        self.diagnostics.push(report(self.source, span.start, RULE, MESSAGE.to_string()));
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

    /// Wraps a class body in a store, so each test reads as the code it is about.
    fn store(body: &str) -> String {
        format!("class Store extends Carburetor {{\n{body}\n}}\n")
    }

    #[test]
    fn an_assignment_through_data_is_reported() {
        let source = store("    rename(name) {\n        this.data.name = name;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_deep_assignment_through_data_is_reported() {
        let source = store("    rename(id, name) {\n        this.data.items[id].name = name;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn replacing_data_itself_is_reported() {
        let source = store("    reset() {\n        this.data = {};\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn an_increment_is_reported() {
        let source = store("    bump() {\n        this.data.count++;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_delete_is_reported() {
        let source = store("    drop(id) {\n        delete this.data.items[id];\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn an_in_place_array_method_is_reported() {
        // No assignment appears anywhere in this one, which is why the walk normalises all four.
        let source = store("    add(id) {\n        this.data.orderIds.push(id);\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_write_through_draft_is_the_supported_form() {
        let source = store("    rename(name) {\n        this.draft.name = name;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_that_is_not_a_store_is_left_alone() {
        let source = "class Plain {\n    rename(name) {\n        this.data.name = name;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_write_through_a_cast_is_still_a_write() {
        let source = store("    rename(name) {\n        (this.data as any).name = name;\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }
}
