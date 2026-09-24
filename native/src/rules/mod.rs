//! The rule registry, and the machinery every rule shares.

use oxc_ast::ast::Program;

use crate::config::{Config, Severity};
use crate::fix::Fix;
use crate::{Diagnostic, Source};

mod allocations;
mod boundaries;
mod data;
mod effects;
mod lifecycle;
mod support;

/// What every rule is: one pass over a parsed file, producing diagnostics.
type Check = fn(&Program<'_>, &Source<'_>) -> Vec<Diagnostic>;

/// Every rule, by the id it reports under. Adding a rule is adding a row; the severity table in
/// `config.rs` decides whether the row runs at all.
const REGISTRY: [(&str, Check); 24] = [
    (
        allocations::require_method_for_closure::RULE,
        allocations::require_method_for_closure::check,
    ),
    (
        allocations::require_module_function::RULE,
        allocations::require_module_function::check,
    ),
    (
        lifecycle::no_lifecycle_class_property::RULE,
        lifecycle::no_lifecycle_class_property::check,
    ),
    (
        data::reads::no_computed_get_in_computed::RULE,
        data::reads::no_computed_get_in_computed::check,
    ),
    (
        data::reads::no_computed_get_in_render::RULE,
        data::reads::no_computed_get_in_render::check,
    ),
    (
        data::reads::no_escaping_tracked_data::RULE,
        data::reads::no_escaping_tracked_data::check,
    ),
    (
        data::reads::no_get_data_in_render::RULE,
        data::reads::no_get_data_in_render::check,
    ),
    (
        data::reads::no_use_carburetor_outside_render::RULE,
        data::reads::no_use_carburetor_outside_render::check,
    ),
    (
        data::writes::no_direct_data_write::RULE,
        data::writes::no_direct_data_write::check,
    ),
    (
        data::writes::no_external_data_mutation::RULE,
        data::writes::no_external_data_mutation::check,
    ),
    (
        data::writes::no_store_write_in_render::RULE,
        data::writes::no_store_write_in_render::check,
    ),
    (
        data::writes::no_tracked_data_mutation::RULE,
        data::writes::no_tracked_data_mutation::check,
    ),
    (
        data::writes::no_untrackable_draft_mutation::RULE,
        data::writes::no_untrackable_draft_mutation::check,
    ),
    (
        data::writes::require_emit_after_draft_write::RULE,
        data::writes::require_emit_after_draft_write::check,
    ),
    (
        lifecycle::no_handler_created_in_render::RULE,
        lifecycle::no_handler_created_in_render::check,
    ),
    (
        lifecycle::require_bind_for_passed_method::RULE,
        lifecycle::require_bind_for_passed_method::check,
    ),
    (
        lifecycle::require_super_in_lifecycle::RULE,
        lifecycle::require_super_in_lifecycle::check,
    ),
    (
        effects::no_async_effect::RULE,
        effects::no_async_effect::check,
    ),
    (
        effects::no_duplicate_effect_name::RULE,
        effects::no_duplicate_effect_name::check,
    ),
    (
        effects::require_effect_deps::RULE,
        effects::require_effect_deps::check,
    ),
    (
        boundaries::no_async_transaction::RULE,
        boundaries::no_async_transaction::check,
    ),
    (
        boundaries::no_module_level_store::RULE,
        boundaries::no_module_level_store::check,
    ),
    (
        boundaries::no_untrackable_store_data::RULE,
        boundaries::no_untrackable_store_data::check,
    ),
    (
        boundaries::require_subscription_disposal::RULE,
        boundaries::require_subscription_disposal::check,
    ),
];

/// Turns a byte offset into a 1-based line and column, the way an editor counts them.
pub fn locate(text: &str, offset: u32) -> (usize, usize) {
    let limit = (offset as usize).min(text.len());
    let before = &text[..limit];
    let line = before.matches('\n').count() + 1;
    let column = before
        .rsplit('\n')
        .next()
        .map_or(0, |last| last.chars().count())
        + 1;

    (line, column)
}

/// Builds a diagnostic at a source offset. The severity is what a rule means when it reports at
/// all; [`run`] stamps the configured one over it, because only the config knows how hard to say it.
pub fn report(source: &Source, offset: u32, rule: &str, message: String) -> Diagnostic {
    report_with_fix(source, offset, rule, message, None)
}

/// Builds a diagnostic that also carries a suggested edit, for a rule `--fix` can act on. `fix` is
/// `None` for the same violation shape a rule cannot safely rewrite mechanically — the diagnostic
/// still reports, there is just nothing to apply.
pub fn report_with_fix(
    source: &Source,
    offset: u32,
    rule: &str,
    message: String,
    fix: Option<Fix>,
) -> Diagnostic {
    let (line, column) = locate(source.text, offset);

    Diagnostic {
        file: source.path.to_string_lossy().replace('\\', "/"),
        line,
        column,
        rule: rule.to_string(),
        message,
        severity: Severity::Error,
        fix,
    }
}

/// Whether the source could contain a recognized component base.
///
/// Escaped identifiers include a backslash in source spelling, so keep those on the full parse
/// path instead of risking a false negative in this raw-text fast path.
fn may_contain_component_base(text: &str) -> bool {
    text.contains('\\')
        || crate::rules::support::bases::COMPONENT_BASES
            .iter()
            .any(|base| text.contains(base))
}

/// Runs the rules the configuration leaves on over one parsed file.
///
/// A rule set to `off` is not merely filtered out of the output — it never runs, so turning rules
/// off makes the pass cheaper rather than only quieter.
pub fn run(program: &Program<'_>, source: &Source, config: &Config) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let method_severity = config.severity(allocations::require_method_for_closure::RULE);
    let module_severity = config.severity(allocations::require_module_function::RULE);
    let allocation_semantic = if (method_severity != Severity::Off
        || module_severity != Severity::Off)
        && may_contain_component_base(source.text)
    {
        Some(crate::rules::support::closures::build_semantic(program))
    } else {
        None
    };

    for (rule, check) in REGISTRY {
        let severity = config.severity(rule);

        if severity == Severity::Off {
            continue;
        }

        let reports =
            match rule {
                allocations::require_method_for_closure::RULE => allocation_semantic
                    .as_ref()
                    .map_or_else(Vec::new, |semantic| {
                        allocations::require_method_for_closure::check_with_semantic(
                            program, source, semantic,
                        )
                    }),
                allocations::require_module_function::RULE => allocation_semantic
                    .as_ref()
                    .map_or_else(Vec::new, |semantic| {
                        allocations::require_module_function::check_with_semantic(
                            program, source, semantic,
                        )
                    }),
                _ => check(program, source),
            };

        diagnostics.extend(reports.into_iter().map(|mut diagnostic| {
            diagnostic.severity = severity;

            diagnostic
        }));
    }

    diagnostics
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    fn run_with(text: &str, method: Severity, module: Severity) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

        let mut config = Config::default();
        config
            .override_rule(allocations::require_method_for_closure::RULE, method)
            .expect("registered rule");
        config
            .override_rule(allocations::require_module_function::RULE, module)
            .expect("registered rule");

        run(
            &parsed.program,
            &Source {
                path: Path::new("fixture.tsx"),
                text,
            },
            &config,
        )
    }

    const ALLOCATION_SOURCE: &str = r#"
class Widget extends AntiHookComponent {
    render() {
        return this.items.map((item) => this.renderItem(item));
    }

    helper(item: number) {
        return item;
    }
}
"#;

    #[test]
    fn allocation_rules_keep_registry_order_and_configured_severity_when_both_run() {
        let diagnostics = run_with(ALLOCATION_SOURCE, Severity::Error, Severity::Warn);

        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [
                allocations::require_method_for_closure::RULE,
                allocations::require_module_function::RULE,
            ]
        );
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.severity)
                .collect::<Vec<_>>(),
            [Severity::Error, Severity::Warn]
        );
    }

    #[test]
    fn allocation_rules_run_independently_when_the_other_rule_is_off() {
        let method_only = run_with(ALLOCATION_SOURCE, Severity::Warn, Severity::Off);
        assert_eq!(
            method_only
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::require_method_for_closure::RULE]
        );

        let module_only = run_with(ALLOCATION_SOURCE, Severity::Off, Severity::Error);
        assert_eq!(
            module_only
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::require_module_function::RULE]
        );
        assert_eq!(module_only[0].severity, Severity::Error);
    }

    #[test]
    fn allocation_prefilter_keeps_direct_and_same_file_component_bases() {
        let direct = run_with(ALLOCATION_SOURCE, Severity::Error, Severity::Off);
        assert_eq!(
            direct[0].rule,
            allocations::require_method_for_closure::RULE
        );

        let subclass = run_with(
            r#"
class Base extends AntiHookComponent {}
class Widget extends Base {
    render() {
        return this.items.map((item) => this.renderItem(item));
    }
}
"#,
            Severity::Error,
            Severity::Off,
        );
        assert_eq!(
            subclass
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::require_method_for_closure::RULE]
        );
    }

    #[test]
    fn allocation_prefilter_falls_back_for_escaped_component_base_identifiers() {
        let source = r#"
class Widget extends AntiHook\u0043omponent {
    render() {
        return this.items.map((item) => this.renderItem(item));
    }
}
"#;
        assert!(may_contain_component_base(source));
        let diagnostics = run_with(source, Severity::Error, Severity::Off);

        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::require_method_for_closure::RULE]
        );
    }

    #[test]
    fn allocation_prefilter_skips_files_without_component_markers() {
        let source = r#"
class Widget {
    render() {
        return this.items.map((item) => this.renderItem(item));
    }
}
"#;
        assert!(!may_contain_component_base(source));
        assert!(run_with(source, Severity::Error, Severity::Error).is_empty());
    }
}
