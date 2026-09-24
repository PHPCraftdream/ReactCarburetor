//! H29: a closure inside a component's member that the class could own as a method.
//!
//! Every call of the member builds the closure again — every render, when the member is `render` —
//! an allocation the class does not need: what the closure reads is either already on `this` or a
//! local a method parameter could carry. Nothing breaks; the engine just builds a function object
//! per call that a declared method would build once. The rule reports the closures whose rewrite
//! leaves no per-call allocation behind and says how to declare the method: re-read the
//! this-derived values from `this` inside it, take the plain locals as parameters, and decorate it
//! with `@bind` when the closure is handed somewhere as a value.
//!
//! A plain local captured by a callback blocks the report — passing it by value would freeze a
//! value that is supposed to change — and so does a closure that writes one. A closure that is
//! nothing but a forward to a method gets shorter advice: pass the method itself, bound once.
//! See docs/hazards.md, H29.

use std::collections::HashMap;

use oxc_ast::ast::{Class, MethodDefinition, Program, PropertyDefinition, PropertyKey};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::closures::{
    analyze_field, analyze_method, build_semantic, is_component_class, Candidate, Capture,
    MemberAnalysis, Usage,
};
use crate::rules::support::names::property_key_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-method-for-closure";

/// Whether the capture survives the extraction the rule asks for.
///
/// A this-derived capture is re-read from `this` inside the method, so its usage does not matter.
/// Any other capture has to be a never-written local, and even then only a directly-called helper
/// can take one: a callback's captures freeze at closure creation, where a method's parameters
/// would not.
fn passable(capture: &Capture<'_>, usage: &Usage<'_>) -> bool {
    capture.this_derived || matches!(usage, Usage::DirectHelper(_)) && !capture.written_after_init
}

/// The message for one reportable closure: what the allocation costs, and what to declare instead.
fn message(candidate: &Candidate<'_>, member: Option<&str>) -> String {
    let cadence = if candidate.executes_in_render {
        String::from("on every render")
    } else {
        match member {
            Some(name) => format!("on every call of `{name}`"),
            None => String::from("on every call"),
        }
    };

    // A pure forwarder's rewrite is smaller than an extraction: the method it already calls goes
    // where the closure is, bound once, instead of the wrapper being built once per call.
    if let Some(forwarder) = &candidate.forwarder {
        return format!(
            "this closure is rebuilt {cadence} doing nothing but forwarding to `this.{}` — pass \
             `this.{}` directly, bound once with @bind, instead of allocating the wrapper.",
            forwarder.method, forwarder.method
        );
    }

    let quoted = |names: &[&str]| {
        names
            .iter()
            .map(|name| format!("`{name}`"))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let this_derived: Vec<&str> = candidate
        .captures
        .iter()
        .filter(|capture| capture.this_derived)
        .map(|capture| capture.name)
        .collect();

    let plain: Vec<&str> = candidate
        .captures
        .iter()
        .filter(|capture| !capture.this_derived)
        .map(|capture| capture.name)
        .collect();

    let mut rewrite = String::from("Declare it as a method");

    if matches!(candidate.usage, Usage::Callback) {
        rewrite.push_str(", decorated with @bind because it is handed over as a value");
    }

    if !this_derived.is_empty() {
        rewrite.push_str(&format!(
            ", reading {} from `this` inside it",
            quoted(&this_derived)
        ));
    }

    if !plain.is_empty() {
        let count = if plain.len() > 1 {
            "parameters"
        } else {
            "a parameter"
        };

        rewrite.push_str(&format!(" and taking {} as {count}", quoted(&plain)));
    }

    rewrite.push('.');

    format!(
        "this closure is rebuilt {cadence} — an allocation the class does not need, since \
         everything it uses is on `this` or can be passed in. {rewrite}"
    )
}

/// One pass over one file: which of its classes are components, and the reports the members of
/// those classes earn.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    /// Whether each class in the file is a component, keyed by the class's span — the only
    /// identity a class has across the walk's callbacks, and what keeps a nested class's answer
    /// from standing in for its enclosing one.
    components: HashMap<Span, bool>,
    diagnostics: Vec<Diagnostic>,
}

impl<'s, 'a> Check<'s, 'a> {
    /// Whether the class the walk is in is a component, by the same-file heritage walk (D6).
    fn component(&self, context: &Context) -> bool {
        context
            .class_span
            .and_then(|span| self.components.get(&span))
            .copied()
            .unwrap_or(false)
    }

    /// Whether the member is `render`.
    fn is_render_key(key: &PropertyKey<'_>) -> bool {
        property_key_name(key).is_some_and(|name| RENDER_METHODS.contains(&name))
    }

    /// Reports the member's candidates whose extraction leaves no per-call allocation behind.
    fn report_member(&mut self, analysis: MemberAnalysis<'_>, context: &Context) {
        for candidate in analysis.closures {
            if !candidate.class_dependency {
                continue;
            }

            if candidate
                .captures
                .iter()
                .any(|capture| !passable(capture, &candidate.usage))
            {
                continue;
            }

            let message = message(&candidate, context.member.as_deref());

            self.diagnostics
                .push(report(self.source, candidate.span.start, RULE, message));
        }
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
        let component = is_component_class(class, self.semantic);

        self.components.insert(class.span, component);
    }

    fn method(&mut self, method: &MethodDefinition<'a>, context: &Context) {
        if !self.component(context) {
            return;
        }

        // The walk's `in_render` needs a direct component base; a same-file subclass's render is
        // as much render code as the base's own, so the member name decides here as well.
        let member_is_render = context.in_render || Self::is_render_key(&method.key);

        self.report_member(
            analyze_method(method, self.semantic, member_is_render),
            context,
        );
    }

    fn property(&mut self, property: &PropertyDefinition<'a>, context: &Context) {
        if !self.component(context) {
            return;
        }

        let member_is_render = context.in_render || Self::is_render_key(&property.key);

        self.report_member(
            analyze_field(property, self.semantic, member_is_render),
            context,
        );
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
            semantic,
            components: HashMap::new(),
            diagnostics: Vec::new(),
        },
    )
}

#[cfg(test)]
#[path = "require_method_for_closure/tests.rs"]
mod tests;
