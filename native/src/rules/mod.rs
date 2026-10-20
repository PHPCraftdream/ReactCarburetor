//! The rule registry, and the machinery every rule shares.

use std::collections::HashSet;

use oxc_ast::ast::Program;

use crate::config::{Config, Severity};
use crate::fix::Fix;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

mod allocations;
mod boundaries;
mod data;
#[path = "support/walk/dispatch/mod.rs"]
mod dispatch;
#[cfg(test)]
#[path = "support/walk/dispatch/tests.rs"]
mod dispatch_tests;
mod effects;
mod lifecycle;
mod shared;
mod style;
mod support;

/// What every rule is: one pass over a parsed file, producing diagnostics. `Bases` carries the
/// configured component and store base lists, which decide what the walk recognises.
type Check = fn(&Program<'_>, &Source<'_>, &support::bases::Bases) -> Vec<Diagnostic>;

/// Every rule, by the id it reports under. Adding a rule is adding a row; the severity table in
/// `config.rs` decides whether the row runs at all.
const REGISTRY: [(&str, Check, bool); 37] = [
    (
        boundaries::max_render_depth::RULE,
        boundaries::max_render_depth::check,
        true,
    ),
    (
        allocations::no_closure_in_update::RULE,
        allocations::no_closure_in_update::check,
        true,
    ),
    (
        allocations::require_method_for_closure::RULE,
        allocations::require_method_for_closure::check,
        true,
    ),
    (
        allocations::require_module_function::RULE,
        allocations::require_module_function::check,
        true,
    ),
    (
        lifecycle::no_function_in_render::RULE,
        lifecycle::no_function_in_render::check,
        true,
    ),
    (
        allocations::no_react_hooks_in_components::RULE,
        allocations::no_react_hooks_in_components::check,
        false,
    ),
    (
        lifecycle::no_lifecycle_class_property::RULE,
        lifecycle::no_lifecycle_class_property::check,
        true,
    ),
    (
        data::reads::no_computed_get_in_computed::RULE,
        data::reads::no_computed_get_in_computed::check,
        true,
    ),
    (
        data::reads::no_computed_get_in_render::RULE,
        data::reads::no_computed_get_in_render::check,
        true,
    ),
    (
        data::reads::no_escaping_tracked_data::RULE,
        data::reads::no_escaping_tracked_data::check,
        true,
    ),
    (
        data::reads::no_get_data_in_render::RULE,
        data::reads::no_get_data_in_render::check,
        true,
    ),
    (
        data::reads::no_use_carburetor_outside_render::RULE,
        data::reads::no_use_carburetor_outside_render::check,
        true,
    ),
    (
        data::writes::no_direct_data_write::RULE,
        data::writes::no_direct_data_write::check,
        true,
    ),
    (
        data::writes::no_external_data_mutation::RULE,
        data::writes::no_external_data_mutation::check,
        true,
    ),
    (
        data::writes::no_store_write_in_render::RULE,
        data::writes::no_store_write_in_render::check,
        true,
    ),
    (
        data::writes::no_tracked_data_mutation::RULE,
        data::writes::no_tracked_data_mutation::check,
        true,
    ),
    (
        data::writes::no_untrackable_draft_mutation::RULE,
        data::writes::no_untrackable_draft_mutation::check,
        true,
    ),
    (
        data::writes::require_emit_after_draft_write::RULE,
        data::writes::require_emit_after_draft_write::check,
        true,
    ),
    (
        lifecycle::no_handler_created_in_render::RULE,
        lifecycle::no_handler_created_in_render::check,
        true,
    ),
    (
        lifecycle::require_bind_for_passed_method::RULE,
        lifecycle::require_bind_for_passed_method::check,
        false,
    ),
    (
        lifecycle::require_super_in_lifecycle::RULE,
        lifecycle::require_super_in_lifecycle::check,
        false,
    ),
    (
        effects::no_async_effect::RULE,
        effects::no_async_effect::check,
        true,
    ),
    (
        effects::no_duplicate_effect_name::RULE,
        effects::no_duplicate_effect_name::check,
        true,
    ),
    (
        effects::require_effect_deps::RULE,
        effects::require_effect_deps::check,
        false,
    ),
    (
        boundaries::no_async_transaction::RULE,
        boundaries::no_async_transaction::check,
        false,
    ),
    (
        boundaries::no_module_level_store::RULE,
        boundaries::no_module_level_store::check,
        false,
    ),
    (
        boundaries::no_untrackable_store_data::RULE,
        boundaries::no_untrackable_store_data::check,
        false,
    ),
    (
        boundaries::require_subscription_disposal::RULE,
        boundaries::require_subscription_disposal::check,
        false,
    ),
    (
        boundaries::one_export_per_file::RULE,
        boundaries::one_export_per_file::check,
        false,
    ),
    (
        data::interop::no_memo_over_store_read::RULE,
        data::interop::no_memo_over_store_read::check,
        true,
    ),
    (
        data::interop::no_capturing_hook_selector::RULE,
        data::interop::no_capturing_hook_selector::check,
        true,
    ),
    (
        style::max_line_length::RULE,
        style::max_line_length::check,
        false,
    ),
    (
        style::no_blank_line_after_tsdoc::RULE,
        style::no_blank_line_after_tsdoc::check,
        false,
    ),
    (
        style::no_parent_import::RULE,
        style::no_parent_import::check,
        false,
    ),
    (
        style::prefer_readonly_array_param::RULE,
        style::prefer_readonly_array_param::check,
        false,
    ),
    (
        style::require_tsdoc::RULE,
        style::require_tsdoc::check,
        false,
    ),
    (
        style::tsdoc_blank_line_before_tags::RULE,
        style::tsdoc_blank_line_before_tags::check,
        false,
    ),
];

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
    let (line, column) = source.line_table().locate(source.text, offset);

    Diagnostic {
        file: source.path.to_string_lossy().replace('\\', "/"),
        line,
        column,
        rule: rule.to_string(),
        message,
        severity: Severity::Error,
        fix,
        scope: None,
    }
}

/// The line-start index of one source text, built once per file.
///
/// Every diagnostic and every suppression lookup asks for a line, and rescanning the text from
/// the top for each one makes a file with many findings quadratic; the index answers each in a
/// binary search instead.
pub struct LineTable {
    starts: Vec<u32>,
}

impl LineTable {
    /// Indexes every line start in `text`, first line included.
    pub fn new(text: &str) -> LineTable {
        LineTable {
            starts: std::iter::once(0)
                .chain(text.match_indices('\n').map(|(index, _)| index as u32 + 1))
                .collect(),
        }
    }

    /// The 1-based line an offset sits on.
    pub fn line(&self, text: &str, offset: u32) -> usize {
        let limit = (offset as usize).min(text.len());

        self.starts
            .partition_point(|&start| start as usize <= limit)
    }

    /// Turns a byte offset into a 1-based line and column, the way an editor counts them.
    pub fn locate(&self, text: &str, offset: u32) -> (usize, usize) {
        let limit = (offset as usize).min(text.len());
        let line = self.line(text, offset);
        let start = self.starts[line - 1] as usize;

        (line, text[start..limit].chars().count() + 1)
    }
}

/// The class members whose absence rules out the lifecycle rules for a file.
const LIFECYCLE_MARKERS: [&str; 7] = [
    "render",
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
];

/// Whether the file's own text names something every one of a rule's reports must name.
///
/// Each rule lists its markers as groups, and a report needs one literal hit from every group,
/// so a file that is missing a group's markers cannot produce one and skips the rule entirely.
/// The base groups come from the configured lists, so configuration widens both recognition and
/// the prefilter together. Escaped identifiers carry a backslash in source spelling and disable
/// the check for the whole file rather than risk a false negative.
pub(super) fn rule_possible(rule: &str, text: &str, bases: &Bases) -> bool {
    if text.contains('\\') {
        return true;
    }

    let any = |markers: &[String]| markers.iter().any(|marker| text.contains(marker.as_str()));
    let store = bases.stores();
    let component = bases.components();

    match rule {
        allocations::no_closure_in_update::RULE => any(store) && text.contains("update"),
        lifecycle::no_lifecycle_class_property::RULE
        | lifecycle::require_super_in_lifecycle::RULE => {
            any(component) && LIFECYCLE_MARKERS.iter().any(|marker| text.contains(marker))
        }
        lifecycle::require_bind_for_passed_method::RULE => any(component),
        data::reads::no_computed_get_in_computed::RULE => text.contains("computed"),
        data::reads::no_get_data_in_render::RULE => text.contains("getData"),
        data::reads::no_use_carburetor_outside_render::RULE => {
            any(component) && (text.contains("useCarburetor") || text.contains("useComputed"))
        }
        data::reads::no_escaping_tracked_data::RULE
        | data::writes::no_tracked_data_mutation::RULE => text.contains("useCarburetor"),
        data::writes::no_direct_data_write::RULE => any(store) && text.contains("data"),
        data::writes::no_external_data_mutation::RULE => {
            text.contains("getData") || text.contains("getEntry")
        }
        data::writes::no_store_write_in_render::RULE => [
            "useCarburetor",
            "useComputed",
            "useResource",
            "useCarburetorValue",
            "useComputedValue",
            "useResourceValue",
        ]
        .iter()
        .any(|marker| text.contains(marker)),
        data::writes::no_untrackable_draft_mutation::RULE
        | data::writes::require_emit_after_draft_write::RULE => {
            // `this.draft`, or the draft an `update` callback names whatever it is called.
            any(store) && (text.contains("draft") || text.contains("update"))
        }
        effects::no_async_effect::RULE
        | effects::no_duplicate_effect_name::RULE
        | effects::require_effect_deps::RULE => text.contains("useEffect"),
        boundaries::one_export_per_file::RULE => text.contains("export"),
        boundaries::no_async_transaction::RULE => {
            text.contains("transaction") || text.contains("update")
        }
        boundaries::no_module_level_store::RULE => any(store) || text.contains("Carburetor"),
        boundaries::no_untrackable_store_data::RULE => any(store),
        data::interop::no_memo_over_store_read::RULE => {
            (text.contains("useMemo") || text.contains("useCallback"))
                && ["useCarburetorValue", "useComputedValue", "useResourceValue"]
                    .iter()
                    .any(|marker| text.contains(marker))
        }
        data::interop::no_capturing_hook_selector::RULE => {
            text.contains("useCarburetorValue") || text.contains("useResourceValue")
        }
        style::no_parent_import::RULE => text.contains("../"),
        style::prefer_readonly_array_param::RULE => {
            text.contains('[') || text.contains("Array") || text.contains('\\')
        }
        style::no_blank_line_after_tsdoc::RULE | style::tsdoc_blank_line_before_tags::RULE => {
            text.contains("/*")
        }
        // No static marker: render detection is syntactic, the closure rules reach every class,
        // `require-module-function` at `scope: "all"` reaches every nested function, and
        // `require-tsdoc` reports the comment a file lacks.
        _ => true,
    }
}

/// Runs the rules the configuration leaves on over one parsed file; `keep_overlaps` leaves H31
/// (no-function-in-render) and H32 (no-closure-in-update) beside H29/H30 instead of yielding to
/// them at a spot the allocation rules reported.
///
/// A rule set to `off` is not merely filtered out of the output — it never runs, so turning rules
/// off makes the pass cheaper rather than only quieter.
pub fn run(
    program: &Program<'_>,
    source: &Source<'_>,
    config: &Config,
    keep_overlaps: bool,
) -> Vec<Diagnostic> {
    dispatch::run(program, source, config, keep_overlaps, true)
}

#[cfg(test)]
pub(super) fn run_internal(
    program: &Program<'_>,
    source: &Source<'_>,
    config: &Config,
    keep_overlaps: bool,
    shared: bool,
) -> Vec<Diagnostic> {
    dispatch::run(program, source, config, keep_overlaps, shared)
}

/// Runs the rules the configuration leaves on over one parsed file; `keep_overlaps` leaves H31
/// (no-function-in-render) and H32 (no-closure-in-update) beside H29/H30 instead of yielding to
/// them at a spot the allocation rules reported.
///
/// A rule set to `off` is not merely filtered out of the output — it never runs, so turning rules
/// off makes the pass cheaper rather than only quieter.
pub(super) fn run_sequential(
    program: &Program<'_>,
    source: &Source<'_>,
    config: &Config,
    keep_overlaps: bool,
) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let bases = support::bases::Bases::from_config(
        config.extra_component_bases(),
        config.extra_store_bases(),
    );
    let method_severity = config.severity(allocations::require_method_for_closure::RULE);
    let module_severity = config.severity(allocations::require_module_function::RULE);
    let handler_severity = config.severity(lifecycle::no_handler_created_in_render::RULE);
    let function_severity = config.severity(lifecycle::no_function_in_render::RULE);
    let memo_severity = config.severity(data::interop::no_memo_over_store_read::RULE);
    let selector_severity = config.severity(data::interop::no_capturing_hook_selector::RULE);
    let module_scope = config.module_function_scope();
    let closure_severity = config.severity(allocations::no_closure_in_update::RULE);
    let transaction_severity = config.severity(boundaries::no_async_transaction::RULE);
    let effect_severity = config.severity(effects::no_async_effect::RULE);
    let hooks_severity = config.severity(allocations::no_react_hooks_in_components::RULE);
    let store_write_severity = config.severity(data::writes::no_store_write_in_render::RULE);
    let disposal_severity = config.severity(boundaries::require_subscription_disposal::RULE);
    let export_severity = config.severity(boundaries::one_export_per_file::RULE);
    // One semantic pass for every rule that reads scopes or symbols; stores and ordinary
    // classes are in its scope too, so no component-marker dependency applies.
    let shared_semantic = if [
        method_severity,
        module_severity,
        handler_severity,
        function_severity,
        memo_severity,
        selector_severity,
        closure_severity,
        transaction_severity,
        effect_severity,
        hooks_severity,
        store_write_severity,
        disposal_severity,
        export_severity,
    ]
    .iter()
    .any(|severity| *severity != Severity::Off)
    {
        Some(crate::rules::support::closures::build_semantic(program))
    } else {
        None
    };

    for (rule, check, _) in REGISTRY {
        let severity = config.severity(rule);

        if severity == Severity::Off || !rule_possible(rule, source.text, &bases) {
            continue;
        }

        let reports = match rule {
            allocations::require_method_for_closure::RULE
            | allocations::require_module_function::RULE
            | lifecycle::no_handler_created_in_render::RULE
            | lifecycle::no_function_in_render::RULE
            | data::interop::no_memo_over_store_read::RULE
            | data::interop::no_capturing_hook_selector::RULE
            | allocations::no_closure_in_update::RULE
            | boundaries::no_async_transaction::RULE
            | effects::no_async_effect::RULE
            | allocations::no_react_hooks_in_components::RULE
            | data::writes::no_store_write_in_render::RULE
            | boundaries::require_subscription_disposal::RULE
            | boundaries::one_export_per_file::RULE => shared::check_with_shared(
                rule,
                program,
                source,
                shared_semantic.as_ref(),
                module_scope,
                &bases,
            ),
            _ => match rule {
                boundaries::max_render_depth::RULE => boundaries::max_render_depth::check_with_max(
                    program,
                    source,
                    config.max_render_depth(),
                    &bases,
                ),
                style::max_line_length::RULE => style::max_line_length::check_with_options(
                    program,
                    source,
                    &config.max_line_length(),
                ),
                style::no_parent_import::RULE => style::no_parent_import::check_with_options(
                    program,
                    source,
                    &config.no_parent_import_roots(),
                ),
                style::require_tsdoc::RULE => style::require_tsdoc::check_with_options(
                    program,
                    source,
                    &config.require_tsdoc(),
                ),
                style::prefer_readonly_array_param::RULE => {
                    style::prefer_readonly_array_param::check(program, source, &bases)
                }
                _ => check(program, source, &bases),
            },
        };

        diagnostics.extend(reports.into_iter().map(|mut diagnostic| {
            diagnostic.severity = severity;

            diagnostic
        }));
    }

    // H31 repeats the allocation rules' finding with blunter advice, and H32 covers a callback
    // H30 might also reach, so both yield wherever H29 or H30 reported at the same spot; when
    // keep_overlaps is set, the blunter diagnostics stay beside the allocation rules' own.
    if !keep_overlaps {
        let allocation_spots = diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic.rule == allocations::require_method_for_closure::RULE
                    || diagnostic.rule == allocations::require_module_function::RULE
            })
            .map(|diagnostic| (diagnostic.line, diagnostic.column))
            .collect::<HashSet<(usize, usize)>>();

        diagnostics.retain(|diagnostic| {
            let overlapped = diagnostic.rule == lifecycle::no_function_in_render::RULE
                || diagnostic.rule == allocations::no_closure_in_update::RULE;

            !overlapped || !allocation_spots.contains(&(diagnostic.line, diagnostic.column))
        });
    }

    diagnostics
}
