//! H35: a render that builds a component tree deeper than the configured maximum.
//!
//! Deep nesting inside one render hides the redraw boundaries: the whole subtree re-renders as
//! one piece, and the props gate and subscriptions cannot cut into it. A render should assemble
//! a shallow tree and move the deeper part into a child component, which then re-renders on its
//! own terms.
//!
//! Only components count as a level — a PascalCase or member name (`<Child>`, `<UI.Card>`).
//! Lowercase DOM tags and fragments (`<>`, `Fragment`, `React.Fragment`) are not levels, but
//! nesting continues through them. JSX in attributes and in expression children continues the
//! owning element's depth; a nested PascalCase component starts a render of its own. See
//! docs/hazards.md, H35.

use oxc_ast::ast::Program;
use oxc_span::Span;

use crate::config::DEFAULT_MAX;
use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::walk::{walk_rule, Context, JsxTag, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/max-render-depth";

/// One open element: the depth, suppression and scope to restore on leaving it, and whether the
/// element hangs structurally on the render being counted.
struct Frame {
    depth: u32,
    suppressed: bool,
    scope: Option<Span>,
    /// The element continues an enclosing render's tree, even once `in_render` is no longer set —
    /// JSX in an attribute or expression child of the render's own elements belongs to it.
    linked: bool,
}

struct Check<'s, 'a> {
    source: &'s Source<'s>,
    max: u32,
    diagnostics: Vec<Diagnostic>,
    /// The render scope the current depth belongs to; a new render resets the count.
    scope: Option<Span>,
    depth: u32,
    /// Per open element, the depth, suppression and scope to restore on leaving it.
    stack: Vec<Frame>,
    /// Whether the subtree under the current element is already reported past.
    suppressed: bool,
    marker: std::marker::PhantomData<&'a ()>,
}

impl Check<'_, '_> {
    fn enter(&mut self, span: Span, tag: JsxTag, context: &Context) {
        // The state to restore is captured before any reset: a nested render (a memo callback,
        // a nested component) must not leak its zeroed depth or its scope into the frame the
        // owner's branch restores from.
        let outer = Frame {
            depth: self.depth,
            suppressed: self.suppressed,
            scope: self.scope,
            linked: false,
        };
        let linked = if context.in_render {
            if self.scope != context.render_scope {
                // A new render (a nested component function) starts counting from zero.
                self.scope = context.render_scope;
                self.depth = 0;
                self.suppressed = false;
            }
            true
        } else {
            // Not in a render, but still structurally under one: a render-prop arrow, a JSX
            // attribute expression. It continues the nearest enclosing element's render.
            self.stack.last().is_some_and(|frame| frame.linked)
        };
        self.stack.push(Frame { linked, ..outer });

        if !linked || tag != JsxTag::Component {
            return;
        }

        self.depth += 1;
        if self.depth > self.max && !self.suppressed {
            self.diagnostics.push(report(
                self.source,
                span.start,
                RULE,
                format!(
                    "this render's tree is deeper than {} components; move the deeper part into \
                     a child component.",
                    self.max
                ),
            ));
            self.suppressed = true;
        }
    }

    fn leave(&mut self) {
        if let Some(frame) = self.stack.pop() {
            self.depth = frame.depth;
            self.suppressed = frame.suppressed;
            self.scope = frame.scope;
        }
    }
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
    fn finish(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut self.diagnostics)
    }

    fn jsx_element(&mut self, span: Span, tag: JsxTag, context: &Context) {
        self.enter(span, tag, context);
    }

    fn leave_jsx_element(&mut self) {
        self.leave();
    }

    fn uses_jsx_elements(&self) -> bool {
        true
    }
}

/// Runs the rule over one parsed file at the configured maximum.
pub fn check(program: &Program<'_>, source: &Source, bases: &Bases) -> Vec<Diagnostic> {
    check_with_max(program, source, DEFAULT_MAX, bases)
}

/// Runs the rule at an explicit maximum; the config supplies [`DEFAULT_MAX`] or its override.
pub(in crate::rules) fn check_with_max(
    program: &Program<'_>,
    source: &Source,
    max: u32,
    bases: &Bases,
) -> Vec<Diagnostic> {
    walk_rule(program, make_rule(source, max), bases)
}

/// Builds this rule's state without traversing the program.
pub(in crate::rules) fn make_rule<'a>(source: &'a Source<'a>, max: u32) -> impl Rule<'a> + 'a {
    Check {
        source,
        max,
        diagnostics: Vec::new(),
        scope: None,
        depth: 0,
        stack: Vec::new(),
        suppressed: false,
        marker: std::marker::PhantomData,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    /// Parses a TSX snippet and runs the rule at an explicit `max`, since the option lives
    /// outside `check`'s fixed signature.
    fn diagnose_max(text: &str, max: u32) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

        check_with_max(
            &parsed.program,
            &Source::new(Path::new("fixture.tsx"), text),
            max,
            &Bases::default(),
        )
    }

    /// Wraps a class render body the way the tests read it.
    fn render(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn depth_three_is_allowed_by_default() {
        let source = render("        return <A><B><C/></B></A>;");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn depth_four_reports_once_on_the_fourth_component() {
        let source = render("        return <A><B><C><D/></C></B></A>;");

        let diagnostics = diagnose(&source, check);

        assert_eq!(lines(&diagnostics), [3], "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, RULE);
    }

    #[test]
    fn the_subtree_under_the_report_is_not_reported_again() {
        let source = render("        return <A><B><C><D><E/></D></C></B></A>;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn dom_tags_and_fragments_do_not_count_but_nesting_continues() {
        let cases = [
            render("        return <A><div><B/><span/></div></A>;"),
            render("        return <A><><B/></></A>;"),
            render("        return <A><Fragment><B/></Fragment></A>;"),
            render("        return <A><React.Fragment><B/></React.Fragment></A>;"),
        ];
        for source in cases {
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{source}"
            );
        }
    }

    #[test]
    fn jsx_in_attributes_and_expressions_continues_the_owner_depth() {
        let attribute = render("        return <A icon={<B/>}/>;");
        assert_eq!(lines(&diagnose(&attribute, check)), [] as [usize; 0]);

        let deep_attribute = render("        return <A><B><C render={<D/>}/></B>;");
        assert_eq!(lines(&diagnose(&deep_attribute, check)), [3]);

        let expression = render("        return <A>{cond && <B/>}</A>;");
        assert_eq!(lines(&diagnose(&expression, check)), [] as [usize; 0]);

        let map = render("        return <A><B><C>{items.map(() => <Row/>)}</C></B></A>;");
        assert_eq!(lines(&diagnose(&map, check)), [3]);
    }

    #[test]
    fn a_nested_pascal_case_component_is_reported_in_its_own_render() {
        let inner = "            return <A><B><C><D/></C></B></A>;";
        let source = render(&format!(
            "        function Inner() {{\n{inner}\n        }}\n        return <Inner/>;"
        ));
        // Inner is a PascalCase function returning JSX, so it is its own render; its depth-four
        // return is on line 4 (line 3 is the `function Inner() {` line) and reports once, and
        // the outer `<Inner/>` alone does not.
        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn a_functional_component_is_checked_the_same_way() {
        let ok = "function Row() {\n    return <A><B><C/></B></A>;\n}\n";
        assert_eq!(lines(&diagnose(ok, check)), [] as [usize; 0]);

        let deep = "function Row() {\n    return <A><B><C><D/></C></B></A>;\n}\n";
        assert_eq!(lines(&diagnose(deep, check)), [2]);
    }

    #[test]
    fn a_camel_case_helper_is_not_a_render() {
        let source = "function renderRows() {\n    return <A><B><C><D/></C></B></A>;\n}\n";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn max_one_reports_on_the_first_component() {
        let source = render("        return <A><B/></A>;");
        assert_eq!(lines(&diagnose_max(&source, 1)), [3]);
    }

    #[test]
    fn max_five_leaves_a_five_deep_tree_alone() {
        let source = render("        return <A><B><C><D><E/></D></C></B></A>;");
        assert_eq!(lines(&diagnose_max(&source, 5)), [] as [usize; 0]);
    }

    #[test]
    fn sibling_branches_are_each_judged_from_the_root() {
        let source = render("        return <div><A><B><C/></B></A><Shallow/></div>;");

        let diagnostics = diagnose(&source, check);

        // Exactly three levels: the DOM `div` does not count, so nothing reports.
        assert_eq!(lines(&diagnostics), [] as [usize; 0], "{diagnostics:#?}");
    }

    #[test]
    fn independent_sibling_branches_report_separately() {
        let source =
            render("        return <div><A><B><C><D/></C></B></A><E><F><G><H/></G></F></E></div>;");

        let diagnostics = diagnose(&source, check);

        // Each branch over the limit reports at its own fourth component, on line 3 (columns
        // 1-based, as `report` fills them in).
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| (diagnostic.line, diagnostic.column))
                .collect::<Vec<_>>(),
            [(3, 30), (3, 55)],
            "{diagnostics:#?}"
        );
    }

    #[test]
    fn a_memo_callback_is_its_own_render_and_the_owner_continues_counting() {
        let source = render("        return <A><B><C child={memo(() => <X/>)}><D/></C></B></A>;");

        let diagnostics = diagnose(&source, check);

        // The memo callback's `<X/>` counts in a fresh render, and afterwards `<D/>` is the
        // owner's fourth component.
        assert_eq!(lines(&diagnostics), [3], "{diagnostics:#?}");
    }

    #[test]
    fn jsx_in_a_render_prop_continues_the_owner_depth() {
        let concise = render("        return <A render={() => <B><C><D/></C></B>}/>;");
        assert_eq!(lines(&diagnose(&concise, check)), [3]);

        let block_bodied =
            render("        return <A render={() => { return <B><C><D/></C></B>; }}/>;");
        assert_eq!(lines(&diagnose(&block_bodied, check)), [3]);
    }
}
