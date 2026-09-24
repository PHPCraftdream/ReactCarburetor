//! H30: a closure or a member that uses nothing from the class it sits in.
//!
//! Every call of the member builds the closure again — every render, when the member is `render` —
//! and a function-valued field is rebuilt once per instance: allocations the module does not need,
//! because the code depends on nothing around it. Where `require-method-for-closure` reports the
//! closures the class could own, this rule reports the opposite corner — the code that does not
//! need the class at all and can be declared once at module level, where one copy serves every
//! instance and every call. See docs/hazards.md, H30.
//!
//! A member is only a candidate when nothing outside this analysis's reach calls it by name: React
//! calls the lifecycle hooks on the instance, the component base calls its own override points as
//! `this.<name>()`, and an `implements` clause may be a contract the crate cannot see. Those stay
//! where they are whatever their bodies use.

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-module-function";

mod extract;
mod references;
mod statement;
mod support;

use std::collections::HashMap;

use oxc_ast::ast::{
    Class, Expression, MethodDefinition, MethodDefinitionKind, Program, PropertyDefinition,
    PropertyKey,
};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::fix::Fix;
use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::closures::{
    analyze_field, analyze_method, build_semantic, is_component_class, MemberAnalysis,
};
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::rules::{report, report_with_fix};
use crate::{Diagnostic, Source};

use self::extract::{member_fix, Extracted};
use self::statement::{top_level_class_statements, StatementFix};
use self::support::{closure_message, framework_called, member_message, member_name, passable};

/// What one class needed to know across the walk: whether it is a component by the same-file
/// heritage walk (D6), and whether it declares an interface this crate cannot check.
#[derive(Clone, Copy)]
struct ClassFacts {
    component: bool,
    implements: bool,
}

/// One pass over one file: which of its classes are components, and the reports the members and
/// closures of those classes earn.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    program: &'s Program<'a>,
    /// The class statements a member can be extracted out of, keyed by the class's span.
    statements: HashMap<Span, StatementFix>,
    /// The facts of each class in the file, keyed by the class's span — the only identity a class
    /// has across the walk's callbacks, and what keeps a nested class's answer from standing in
    /// for its enclosing one.
    classes: HashMap<Span, ClassFacts>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// The facts of the class the walk is in, when that class is one of this rule's own.
    fn facts(&self, context: &Context) -> Option<ClassFacts> {
        context
            .class_span
            .and_then(|span| self.classes.get(&span))
            .copied()
            .filter(|facts| facts.component)
    }

    /// Whether the member is `render`.
    fn is_render_key(key: &PropertyKey<'_>) -> bool {
        member_name(key).is_some_and(|name| RENDER_METHODS.contains(&name))
    }

    /// §7.3's fix for a reportable member, when every precondition it adds on top of the report
    /// holds: the class is a top-level statement, every reference to the member in the file has
    /// the `this.<name>` form the rewrite replaces, and no like-named binding — module-level, or
    /// visible at a rewritten call site — would capture the extracted name.
    fn fix_for(&self, context: &Context, extracted: Extracted<'_>, name: &str) -> Option<Fix> {
        let class_span = context.class_span?;
        let statement = *self.statements.get(&class_span)?;

        member_fix(
            self.program,
            self.source.text,
            self.semantic,
            statement,
            class_span,
            &extracted,
            name,
        )
    }

    /// Reports the member's closures that need nothing from the class — the mirror image of
    /// `require-method-for-closure`'s condition, which takes the class-dependent ones.
    fn report_closures(&mut self, analysis: MemberAnalysis<'_>, context: &Context) {
        for candidate in analysis.closures {
            if candidate.class_dependency {
                continue;
            }

            if candidate
                .captures
                .iter()
                .any(|capture| !passable(capture, &candidate.usage))
            {
                continue;
            }

            let message = closure_message(&candidate, context.member.as_deref());

            self.diagnostics
                .push(report(self.source, candidate.span.start, RULE, message));
        }
    }

    /// Reports the method itself, when its signature and body need nothing from the class and
    /// nothing outside this analysis's reach calls it by name.
    fn report_method(
        &mut self,
        method: &MethodDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
        context: &Context,
    ) {
        if facts.implements {
            return;
        }

        // The core candidate condition: the signature and body must need nothing from the class.
        if class_dependency {
            return;
        }

        // Getters, setters and the constructor are called for; an ordinary method without a body
        // is a declaration (abstract, `declare`, an overload signature), not code to move.
        if method.kind != MethodDefinitionKind::Method {
            return;
        }

        if method.value.body.is_none() {
            return;
        }

        if method.r#override || method.computed || !method.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&method.key) else {
            return;
        };

        if framework_called(name) {
            return;
        }

        let message = member_message(false);
        let fix = self.fix_for(context, Extracted::Method(method), name);

        self.diagnostics.push(report_with_fix(
            self.source,
            method.span.start,
            RULE,
            message,
            fix,
        ));
    }

    /// The same for a class field, which is only a candidate when its value is a function.
    fn report_field(
        &mut self,
        property: &PropertyDefinition<'_>,
        class_dependency: bool,
        facts: ClassFacts,
        context: &Context,
    ) {
        if facts.implements {
            return;
        }

        if class_dependency {
            return;
        }

        let field_function = matches!(
            &property.value,
            Some(Expression::ArrowFunctionExpression(_)) | Some(Expression::FunctionExpression(_))
        );

        if !field_function {
            return;
        }

        if property.r#override || property.computed || !property.decorators.is_empty() {
            return;
        }

        let Some(name) = member_name(&property.key) else {
            return;
        };

        if framework_called(name) {
            return;
        }

        // A static field is built once per class rather than once per instance, so it takes the
        // plain prototype method's wording.
        let message = member_message(field_function && !property.r#static);
        let fix = match &property.value {
            Some(Expression::ArrowFunctionExpression(arrow)) => {
                self.fix_for(context, Extracted::Field(property, arrow), name)
            }
            _ => None,
        };

        self.diagnostics.push(report_with_fix(
            self.source,
            property.span.start,
            RULE,
            message,
            fix,
        ));
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
        let facts = ClassFacts {
            component: is_component_class(class, self.semantic),
            implements: !class.implements.is_empty(),
        };

        self.classes.insert(class.span, facts);
    }

    fn method(&mut self, method: &MethodDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else {
            return;
        };

        // The walk's `in_render` needs a direct component base; a same-file subclass's render is
        // as much render code as the base's own, so the member name decides here as well.
        let member_is_render = context.in_render || Self::is_render_key(&method.key);

        let analysis = analyze_method(method, self.semantic, member_is_render);

        self.report_method(method, analysis.class_dependency, facts, context);
        self.report_closures(analysis, context);
    }

    fn property(&mut self, property: &PropertyDefinition<'a>, context: &Context) {
        let Some(facts) = self.facts(context) else {
            return;
        };

        let member_is_render = context.in_render || Self::is_render_key(&property.key);

        let analysis = analyze_field(property, self.semantic, member_is_render);

        self.report_field(property, analysis.class_dependency, facts, context);
        self.report_closures(analysis, context);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared by the allocation-rule pair.
pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source<'_>,
    semantic: &Semantic<'a>,
) -> Vec<Diagnostic> {
    walk_rule(
        program,
        Check {
            source,
            program,
            semantic,
            classes: HashMap::new(),
            statements: top_level_class_statements(program),
            diagnostics: Vec::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::extract::has_overload_signature;
    use super::support::BASE_SURFACE_MEMBERS;
    use oxc_ast::ast::Statement;

    use std::collections::HashSet;
    use std::path::Path;

    use super::*;
    use crate::rules::support::testing::{diagnose, lines};
    use oxc_allocator::Allocator;
    use oxc_ast::ast::ClassElement;
    use oxc_ast::AstKind;
    use oxc_ast_visit::Visit;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn reported(source: &str) -> Vec<Diagnostic> {
        diagnose(source, check)
    }

    // ---- §7.3: the autofix ----

    /// Runs the rule, applies the first diagnostic's fix (there is always exactly one violation
    /// in these fixtures), and re-runs the rule over the result — proving the fix is not just
    /// well-formed but actually resolves the violation it was attached to. The same pattern
    /// `no_lifecycle_class_property`'s tests use.
    fn fixed(source: &str) -> String {
        let diagnostics = diagnose(source, check);
        let fix = diagnostics[0].fix.as_ref().expect("a fix was expected");
        let text = crate::fix::apply(source, vec![fix]).expect("the fix changes the text");

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "the fixed source must still parse: {text}"
        );

        let remaining = check(
            &parsed.program,
            &Source {
                path: Path::new("fixture.tsx"),
                text: &text,
            },
        );
        assert!(
            remaining.is_empty(),
            "the fix must resolve the violation, left: {remaining:?}"
        );

        text
    }

    /// Drives the real `--fix` loop over a source with more fixable candidates than one pass
    /// can land, proving the class-statement fixes overlap into one per pass and still
    /// converge.
    fn stabilized(source: &str) -> String {
        let (text, remaining) = crate::stabilize(source.to_string(), |text| {
            let allocator = Allocator::default();
            let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

            parsed.diagnostics.is_empty().then(|| {
                check(
                    &parsed.program,
                    &Source {
                        path: Path::new("fixture.tsx"),
                        text,
                    },
                )
            })
        });

        assert!(
            remaining.is_empty(),
            "every candidate lands across passes, left: {remaining:?}"
        );

        text
    }

    mod fix_output;
    mod reporting_boundaries;
    mod reporting_core;
}
