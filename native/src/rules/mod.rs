//! The rule registry, and the machinery every rule shares.

use oxc_ast::ast::Program;

use crate::config::{Config, Severity};
use crate::fix::Fix;
use crate::{Diagnostic, Source};

mod boundaries;
mod effects;
mod lifecycle;
mod no_lifecycle_class_property;
mod reads;
mod support;
mod writes;

/// What every rule is: one pass over a parsed file, producing diagnostics.
type Check = fn(&Program<'_>, &Source<'_>) -> Vec<Diagnostic>;

/// Every rule, by the id it reports under. Adding a rule is adding a row; the severity table in
/// `config.rs` decides whether the row runs at all.
const REGISTRY: [(&str, Check); 22] = [
    (no_lifecycle_class_property::RULE, no_lifecycle_class_property::check),
    (reads::no_computed_get_in_computed::RULE, reads::no_computed_get_in_computed::check),
    (reads::no_computed_get_in_render::RULE, reads::no_computed_get_in_render::check),
    (reads::no_escaping_tracked_data::RULE, reads::no_escaping_tracked_data::check),
    (reads::no_get_data_in_render::RULE, reads::no_get_data_in_render::check),
    (reads::no_use_carburetor_outside_render::RULE, reads::no_use_carburetor_outside_render::check),
    (writes::no_direct_data_write::RULE, writes::no_direct_data_write::check),
    (writes::no_external_data_mutation::RULE, writes::no_external_data_mutation::check),
    (writes::no_store_write_in_render::RULE, writes::no_store_write_in_render::check),
    (writes::no_tracked_data_mutation::RULE, writes::no_tracked_data_mutation::check),
    (writes::no_untrackable_draft_mutation::RULE, writes::no_untrackable_draft_mutation::check),
    (writes::require_emit_after_draft_write::RULE, writes::require_emit_after_draft_write::check),
    (lifecycle::no_handler_created_in_render::RULE, lifecycle::no_handler_created_in_render::check),
    (
        lifecycle::require_bind_for_passed_method::RULE,
        lifecycle::require_bind_for_passed_method::check,
    ),
    (lifecycle::require_super_in_lifecycle::RULE, lifecycle::require_super_in_lifecycle::check),
    (effects::no_async_effect::RULE, effects::no_async_effect::check),
    (effects::no_duplicate_effect_name::RULE, effects::no_duplicate_effect_name::check),
    (effects::require_effect_deps::RULE, effects::require_effect_deps::check),
    (boundaries::no_async_transaction::RULE, boundaries::no_async_transaction::check),
    (boundaries::no_module_level_store::RULE, boundaries::no_module_level_store::check),
    (boundaries::no_untrackable_store_data::RULE, boundaries::no_untrackable_store_data::check),
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
    let column = before.rsplit('\n').next().map_or(0, |last| last.chars().count()) + 1;

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

/// Runs the rules the configuration leaves on over one parsed file.
///
/// A rule set to `off` is not merely filtered out of the output — it never runs, so turning rules
/// off makes the pass cheaper rather than only quieter.
pub fn run(program: &Program<'_>, source: &Source, config: &Config) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    for (rule, check) in REGISTRY {
        let severity = config.severity(rule);

        if severity == Severity::Off {
            continue;
        }

        diagnostics.extend(check(program, source).into_iter().map(|mut diagnostic| {
            diagnostic.severity = severity;

            diagnostic
        }));
    }

    diagnostics
}
