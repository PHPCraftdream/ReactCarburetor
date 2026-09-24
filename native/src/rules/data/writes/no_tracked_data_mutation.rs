//! H9: a write to data that came from `useCarburetor`.
//!
//! At runtime this throws — the read proxy forbids writes and the type is deeply read-only — so it
//! only becomes silent once a cast is involved, which is exactly what people reach for when the
//! compiler complains. Catching it in the linter keeps the cast from being written in the first
//! place.
//!
//! Unlike the escape rule, a destructured branch counts here: `const {items} = this.useCarburetor(s)`
//! still yields a proxy, and writing through `items` fails the same way. See docs/hazards.md, H9.

use std::collections::HashMap;

use oxc_ast::ast::{BindingPattern, Expression, Program, VariableDeclarator};
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::chain::ChainRoot;
use crate::rules::support::names::{called_on_this, member_call_name};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-tracked-data-mutation";

const MESSAGE: &str = "data read through useCarburetor is read-only: this write throws at runtime, \
    and silently does nothing once a cast hides it from the compiler. Call a method on the \
    carburetor, which writes through draft and knows which paths changed.";

/// The names a `useCarburetor` result is bound to, including a destructured branch.
fn bound_names(pattern: &BindingPattern<'_>) -> Vec<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => vec![identifier.name.to_string()],
        BindingPattern::ObjectPattern(object) => object
            .properties
            .iter()
            .filter_map(|property| property.value.get_binding_identifier())
            .map(|identifier| identifier.name.to_string())
            .collect(),
        _ => Vec::new(),
    }
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Binding name -> the function it was read in, so a same-named local elsewhere stays safe.
    tracked: HashMap<String, Span>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn declarator(&mut self, declarator: &VariableDeclarator<'a>, context: &Context) {
        let Some(Expression::CallExpression(call)) = &declarator.init else {
            return;
        };

        if member_call_name(&call.callee) != Some("useCarburetor") || !called_on_this(&call.callee) {
            return;
        }

        for name in bound_names(&declarator.id) {
            self.tracked.insert(name, context.function);
        }
    }

    fn mutation(&mut self, root: &ChainRoot<'_, 'a>, span: Span, _context: &Context) {
        let Some(name) = root.identifier() else {
            return;
        };

        let Some(owner) = self.tracked.get(name) else {
            return;
        };

        if !Context::within(span, *owner) {
            return;
        }

        self.diagnostics.push(report(self.source, span.start, RULE, MESSAGE.to_string()));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new(), tracked: HashMap::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a render body in a component, so each test reads as the code it is about.
    fn render(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn a_write_to_tracked_data_is_reported() {
        let source = render("        const data = this.useCarburetor(store);\n        data.x = 1;");

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn a_write_to_a_destructured_branch_is_reported() {
        let source =
            render("        const {items} = this.useCarburetor(store);\n        items[id] = todo;");

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn a_push_into_tracked_data_is_reported() {
        let source = render("        const d = this.useCarburetor(store);\n        d.ids.push(id);");

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn a_write_hidden_behind_a_cast_is_still_reported() {
        let source = render("        const d = this.useCarburetor(store);\n        (d as any).x = 1;");

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn reading_tracked_data_is_the_point_of_it() {
        let source = render("        const d = this.useCarburetor(store);\n        return d.x;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_same_named_local_in_another_method_is_not_the_tracked_one() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const data = this.useCarburetor(store);\n        return data.x;\n    }\n\n    \
                      save() {\n        const data = {};\n        data.x = 1;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_plain_local_is_not_tracked_data() {
        let source = render("        const data = {};\n        data.x = 1;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }
}
