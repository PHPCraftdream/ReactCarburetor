//! H13: a lifecycle method declared as a class property.
//!
//! A class field is installed on the instance and shadows the prototype method for good, so the
//! base implementation React would have called is gone — in an earlier version of this library
//! exactly this silently disabled every effect in a component. See docs/hazards.md, H13.

use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, Class, ClassElement, Expression, Program,
    PropertyDefinition, PropertyKey, TSAccessibility,
};
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;

use crate::fix::Fix;
use crate::rules::report_with_fix;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-lifecycle-class-property";

const COMPONENT_BASES: [&str; 2] = ["AntiHookComponent", "ScopedAntiHookComponent"];

const LIFECYCLE_NAMES: [&str; 7] = [
    "render",
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
];

/// The name a base class is referenced by, bare or through a namespace.
fn super_class_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

fn is_component(class: &Class<'_>) -> bool {
    class
        .heritage
        .as_ref()
        .and_then(|heritage| super_class_name(&heritage.expression))
        .is_some_and(|name| COMPONENT_BASES.contains(&name))
}

/// The name a class member is declared under, when it is knowable statically.
fn member_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

/// Rewrites `name = (params) => body` into `name(params) body`, verbatim except for that syntax,
/// when the property is plain enough for the substitution to be safe. Accessibility, `override`,
/// `async`, generics, a return type annotation and a rest parameter all mean the same thing on a
/// method as they did on the property's arrow, so all of them are carried over; a decorator, an
/// explicit type on the property itself, `readonly`, `optional` or `definite` are not — a
/// decorator's meaning can depend on the property/method distinction, and the rest have no method
/// equivalent to carry them to.
///
/// Built from source-text slices rather than reconstructed from the AST, so whatever formatting
/// the parameters and body already had — comments, default values, destructuring — survives
/// untouched; only the property's own `name = ... =>` shell is what changes.
fn fix_for(property: &PropertyDefinition, arrow: &ArrowFunctionExpression, source: &str) -> Option<Fix> {
    let plain = !property.computed
        && property.decorators.is_empty()
        && property.type_annotation.is_none()
        && !property.optional
        && !property.definite
        && !property.readonly
        && !property.declare;

    if !plain {
        return None;
    }

    let slice = |span: oxc_span::Span| &source[span.start as usize..span.end as usize];

    let accessibility_prefix = match property.accessibility {
        Some(TSAccessibility::Public) => "public ",
        Some(TSAccessibility::Protected) => "protected ",
        Some(TSAccessibility::Private) => "private ",
        None => "",
    };
    let override_prefix = if property.r#override { "override " } else { "" };
    let async_prefix = if arrow.r#async { "async " } else { "" };
    let key_text = slice(property.key.span());
    let type_parameters_text = arrow.type_parameters.as_deref().map_or("", |declaration| slice(declaration.span));
    let params_text = slice(arrow.params.span);
    let return_type_text = arrow.return_type.as_deref().map_or("", |annotation| slice(annotation.span));
    let body_text = match &arrow.body {
        ArrowFunctionBody::FunctionBody(block) => slice(block.span).to_string(),
        expression => format!("{{ return {}; }}", slice(expression.span())),
    };

    Some(Fix {
        start: property.span.start,
        end: property.span.end,
        text: format!(
            "{accessibility_prefix}{override_prefix}{async_prefix}{key_text}{type_parameters_text}\
             {params_text}{return_type_text} {body_text}"
        ),
    })
}

struct Visitor<'a> {
    source: &'a Source<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Visit<'a> for Visitor<'a> {
    fn visit_class(&mut self, class: &Class<'a>) {
        if is_component(class) {
            for element in &class.body.body {
                let ClassElement::PropertyDefinition(property) = element else {
                    continue;
                };

                if property.r#static {
                    continue;
                }

                let Some(name) = member_name(&property.key) else {
                    continue;
                };

                if !LIFECYCLE_NAMES.contains(&name) {
                    continue;
                }

                let fix = match &property.value {
                    Some(Expression::ArrowFunctionExpression(arrow)) => {
                        fix_for(property, arrow, self.source.text)
                    }
                    _ => None,
                };

                self.diagnostics.push(report_with_fix(
                    self.source,
                    property.span.start,
                    RULE,
                    format!(
                        "\"{name}\" is declared as a class property, which shadows the base \
                         implementation on the prototype: effects, subscription cleanup or the \
                         props gate will silently stop working. Declare it as a method and call \
                         super, or override useEffects/unUseEffects instead."
                    ),
                    fix,
                ));
            }
        }

        // Keep walking: a class can hold another class, and a class expression can sit anywhere.
        oxc_ast_visit::walk::walk_class(self, class);
    }
}

pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut visitor = Visitor {
        source,
        diagnostics: Vec::new(),
    };

    visitor.visit_program(program);

    visitor.diagnostics
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::check;
    use crate::rules::support::testing::diagnose;
    use crate::Source;

    /// Runs the rule, applies the first diagnostic's fix (there is always exactly one violation in
    /// these fixtures), and re-runs the rule over the result — proving the fix is not just
    /// well-formed but actually resolves the violation it was attached to.
    fn fixed(source: &str) -> String {
        let diagnostics = diagnose(source, check);
        let fix = diagnostics[0].fix.as_ref().expect("a fix was expected");
        let text = crate::fix::apply(source, vec![fix]).expect("the fix changes the text");

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty(), "the fixed source must still parse: {text}");

        let remaining = check(&parsed.program, &Source { path: std::path::Path::new("fixture.tsx"), text: &text });
        assert!(remaining.is_empty(), "the fix must resolve the violation, left: {remaining:?}");

        text
    }

    #[test]
    fn a_block_body_property_is_fixed_into_a_method() {
        let source = "class C extends AntiHookComponent {\n    componentDidMount = () => {\n        this.started = true;\n    };\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    componentDidMount() {\n        this.started = true;\n    }\n}\n"
        );
    }

    #[test]
    fn a_concise_body_property_is_fixed_with_an_explicit_return() {
        let source = "class C extends AntiHookComponent {\n    shouldComponentUpdate = (next) => next.id !== this.props.id;\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    shouldComponentUpdate(next) { return next.id !== this.props.id; }\n}\n"
        );
    }

    #[test]
    fn an_async_property_keeps_its_async_keyword() {
        let source = "class C extends AntiHookComponent {\n    componentDidMount = async () => {\n        await this.load();\n    };\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    async componentDidMount() {\n        await this.load();\n    }\n}\n"
        );
    }

    #[test]
    fn a_string_literal_key_is_preserved_verbatim() {
        let source = "class C extends AntiHookComponent {\n    \"componentDidMount\" = () => {};\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    \"componentDidMount\"() {}\n}\n"
        );
    }

    #[test]
    fn a_decorated_property_is_reported_without_a_fix() {
        let source = "class C extends AntiHookComponent {\n    @bind\n    componentDidMount = () => {};\n}\n";
        let diagnostics = diagnose(source, check);

        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].fix.is_none(), "a decorator changes what the rewrite would mean");
    }

    #[test]
    fn an_accessibility_modifier_carries_over_to_the_method() {
        let source = "class C extends AntiHookComponent {\n    private componentDidMount = () => {};\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    private componentDidMount() {}\n}\n"
        );
    }

    #[test]
    fn an_override_modifier_carries_over_to_the_method() {
        let source = "class C extends AntiHookComponent {\n    override componentDidMount = () => {};\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    override componentDidMount() {}\n}\n"
        );
    }

    #[test]
    fn an_explicit_property_type_is_reported_without_a_fix() {
        let source =
            "class C extends AntiHookComponent {\n    componentDidMount: () => void = () => {};\n}\n";
        let diagnostics = diagnose(source, check);

        assert!(diagnostics[0].fix.is_none());
    }

    #[test]
    fn an_arrow_return_type_carries_over_to_the_method() {
        let source = "class C extends AntiHookComponent {\n    shouldComponentUpdate = (): boolean => true;\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    shouldComponentUpdate(): boolean { return true; }\n}\n"
        );
    }

    #[test]
    fn arrow_type_parameters_carry_over_to_the_method() {
        let source =
            "class C extends AntiHookComponent {\n    shouldComponentUpdate = <T,>(next: T) => true;\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    shouldComponentUpdate<T,>(next: T) { return true; }\n}\n"
        );
    }

    #[test]
    fn a_rest_parameter_carries_over_to_the_method() {
        let source =
            "class C extends AntiHookComponent {\n    componentDidMount = (...args: unknown[]) => {};\n}\n";

        assert_eq!(
            fixed(source),
            "class C extends AntiHookComponent {\n    componentDidMount(...args: unknown[]) {}\n}\n"
        );
    }

    #[test]
    fn a_property_with_no_arrow_value_is_reported_without_a_fix() {
        let source = "class C extends AntiHookComponent {\n    componentDidMount = someHandler;\n}\n";
        let diagnostics = diagnose(source, check);

        assert!(diagnostics[0].fix.is_none());
    }
}
