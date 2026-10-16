//! The rule registry, and the machinery every rule shares.

use std::collections::HashSet;

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
const REGISTRY: [(&str, Check); 29] = [
    (allocations::no_closure_in_update::RULE, allocations::no_closure_in_update::check),
    (allocations::require_method_for_closure::RULE, allocations::require_method_for_closure::check),
    (allocations::require_module_function::RULE, allocations::require_module_function::check),
    (lifecycle::no_function_in_render::RULE, lifecycle::no_function_in_render::check),
    (allocations::no_react_hooks_in_components::RULE, allocations::no_react_hooks_in_components::check),
    (lifecycle::no_lifecycle_class_property::RULE, lifecycle::no_lifecycle_class_property::check),
    (data::reads::no_computed_get_in_computed::RULE, data::reads::no_computed_get_in_computed::check),
    (data::reads::no_computed_get_in_render::RULE, data::reads::no_computed_get_in_render::check),
    (data::reads::no_escaping_tracked_data::RULE, data::reads::no_escaping_tracked_data::check),
    (data::reads::no_get_data_in_render::RULE, data::reads::no_get_data_in_render::check),
    (data::reads::no_use_carburetor_outside_render::RULE, data::reads::no_use_carburetor_outside_render::check),
    (data::writes::no_direct_data_write::RULE, data::writes::no_direct_data_write::check),
    (data::writes::no_external_data_mutation::RULE, data::writes::no_external_data_mutation::check),
    (data::writes::no_store_write_in_render::RULE, data::writes::no_store_write_in_render::check),
    (data::writes::no_tracked_data_mutation::RULE, data::writes::no_tracked_data_mutation::check),
    (data::writes::no_untrackable_draft_mutation::RULE, data::writes::no_untrackable_draft_mutation::check),
    (data::writes::require_emit_after_draft_write::RULE, data::writes::require_emit_after_draft_write::check),
    (lifecycle::no_handler_created_in_render::RULE, lifecycle::no_handler_created_in_render::check),
    (lifecycle::require_bind_for_passed_method::RULE, lifecycle::require_bind_for_passed_method::check),
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
    (data::interop::no_memo_over_store_read::RULE, data::interop::no_memo_over_store_read::check),
    (data::interop::no_capturing_hook_selector::RULE, data::interop::no_capturing_hook_selector::check),
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
        scope: None,
    }
}

/// Whether the source could contain a recognized component base.
///
/// Escaped identifiers include a backslash in source spelling, so keep those on the full parse
/// path instead of risking a false negative in this raw-text fast path.
#[cfg(test)]
fn may_contain_component_base(text: &str) -> bool {
    text.contains('\\')
        || crate::rules::support::bases::COMPONENT_BASES
            .iter()
            .any(|base| text.contains(base))
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
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let method_severity = config.severity(allocations::require_method_for_closure::RULE);
    let module_severity = config.severity(allocations::require_module_function::RULE);
    let handler_severity = config.severity(lifecycle::no_handler_created_in_render::RULE);
    let function_severity = config.severity(lifecycle::no_function_in_render::RULE);
    let memo_severity = config.severity(data::interop::no_memo_over_store_read::RULE);
    let selector_severity = config.severity(data::interop::no_capturing_hook_selector::RULE);
    let module_scope = config.module_function_scope();
    // This pass has no component-marker dependency: stores and ordinary classes are in scope too.
    let shared_semantic = if [
        method_severity,
        module_severity,
        handler_severity,
        function_severity,
        memo_severity,
        selector_severity,
    ]
    .iter()
    .any(|severity| *severity != Severity::Off)
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

        let reports = match rule {
            allocations::require_method_for_closure::RULE
            | allocations::require_module_function::RULE
            | lifecycle::no_handler_created_in_render::RULE
            | lifecycle::no_function_in_render::RULE
            | data::interop::no_memo_over_store_read::RULE
            | data::interop::no_capturing_hook_selector::RULE => check_with_shared(
                rule,
                program,
                source,
                shared_semantic.as_ref(),
                module_scope,
            ),
            _ => check(program, source),
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

/// Runs the rules that share one semantic pass; `None` means every one of them is off.
fn check_with_shared<'a>(
    rule: &str,
    program: &'a Program<'a>,
    source: &Source<'_>,
    semantic: Option<&'a oxc_semantic::Semantic<'a>>,
    module_scope: crate::config::ModuleFunctionScope,
) -> Vec<Diagnostic> {
    let Some(semantic) = semantic else { return Vec::new() };
    match rule {
        allocations::require_method_for_closure::RULE => {
            allocations::require_method_for_closure::check_with_semantic(program, source, semantic)
        }
        allocations::require_module_function::RULE => {
            allocations::require_module_function::check_with_semantic(
                program, source, semantic, module_scope,
            )
        }
        lifecycle::no_handler_created_in_render::RULE => {
            lifecycle::no_handler_created_in_render::check_with_semantic(program, source, semantic)
        }
        lifecycle::no_function_in_render::RULE => {
            lifecycle::no_function_in_render::check_with_semantic(program, source, semantic)
        }
        data::interop::no_memo_over_store_read::RULE => {
            data::interop::no_memo_over_store_read::check_with_semantic(program, source, semantic)
        }
        data::interop::no_capturing_hook_selector::RULE => {
            data::interop::no_capturing_hook_selector::check_with_semantic(
                program, source, semantic,
            )
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;
    use crate::config::ModuleFunctionScope;

    fn run_with_overlaps(
        text: &str,
        method: Severity,
        module: Severity,
        keep_overlaps: bool,
    ) -> Vec<Diagnostic> {
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
            keep_overlaps,
        )
    }

    fn run_with(text: &str, method: Severity, module: Severity) -> Vec<Diagnostic> {
        run_with_overlaps(text, method, module, false)
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

        // H31 now reports the map arrow too: H30 claims only the class-free `helper` method, at a
        // different spot, so nothing deduplicates there.
        let module_only = run_with(ALLOCATION_SOURCE, Severity::Off, Severity::Error);
        assert_eq!(
            module_only
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [
                allocations::require_module_function::RULE,
                lifecycle::no_function_in_render::RULE,
            ]
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
    fn scope_all_builds_semantic_for_plain_module_files() {
        let source = r#"
function work(items: string[]) {
    return items.map((item) => item.length);
}
"#;

        // Default scope (all): the prefilter must not gate the rule on component markers.
        let all = run_with(source, Severity::Warn, Severity::Warn);
        assert_eq!(
            all.iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::require_module_function::RULE]
        );

        // scope=classes restores the previous gating: nothing without a component base.
        let mut config = Config::default();
        config
            .override_rule(allocations::require_method_for_closure::RULE, Severity::Warn)
            .unwrap();
        config
            .override_rule(allocations::require_module_function::RULE, Severity::Warn)
            .unwrap();
        config.set_module_function_scope(ModuleFunctionScope::Classes);

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let classes_only = run(
            &parsed.program,
            &Source {
                path: Path::new("fixture.tsx"),
                text: source,
            },
            &config,
            false,
        );
        assert!(classes_only.is_empty());
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

    #[test]
    fn keep_overlaps_leaves_h31_beside_h29() {
        let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return <button onClick={() => this.toggle()}>go</button>;
    }

    toggle() {}
}
"#;

        let deduplicated = run_with_overlaps(source, Severity::Warn, Severity::Off, false);
        let lines = |rule: &str| {
            deduplicated
                .iter()
                .filter(|diagnostic| diagnostic.rule == rule)
                .map(|diagnostic| diagnostic.line)
                .collect::<Vec<_>>()
        };
        assert!(lines(lifecycle::no_function_in_render::RULE).is_empty());
        assert_eq!(
            lines(allocations::require_method_for_closure::RULE),
            [4]
        );

        let kept = run_with_overlaps(source, Severity::Warn, Severity::Off, true);
        let on_arrow = |rule: &str| {
            kept.iter()
                .any(|diagnostic| diagnostic.rule == rule && diagnostic.line == 4)
        };
        assert!(on_arrow(lifecycle::no_function_in_render::RULE));
        assert!(on_arrow(allocations::require_method_for_closure::RULE));
    }

    #[test]
    fn h32_reports_capturing_update_callbacks_in_stores_alone() {
        let source = r#"
class Cart extends Carburetor {
    add(line: number) {
        this.update((draft) => {
            draft.total += line;
        });
    }
}
"#;

        let deduplicated = run_with_overlaps(source, Severity::Warn, Severity::Warn, false);

        // H30 never reaches a store class, so a capturing callback stays H32's finding alone; the
        // spot dedup below is the guard for the day the two ever share one.
        assert_eq!(
            deduplicated
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::no_closure_in_update::RULE]
        );
        assert_eq!(deduplicated[0].severity, Severity::Warn);

        // keep_overlaps changes nothing here: there is nothing to yield to.
        let kept = run_with_overlaps(source, Severity::Warn, Severity::Warn, true);
        assert_eq!(
            kept.iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [allocations::no_closure_in_update::RULE]
        );
    }

    #[test]
    fn a_update_callback_without_captures_is_an_h30_finding_in_a_store() {
        for scope in [ModuleFunctionScope::All, ModuleFunctionScope::Classes] {
            let source = r#"
class Cart extends Carburetor<{count: number}> {
    inc() {
        this.update(draft => {
            draft.count += 1;
        });
    }
}
"#;

            let mut config = Config::default();
            config
                .override_rule(allocations::require_method_for_closure::RULE, Severity::Warn)
                .unwrap();
            config
                .override_rule(allocations::require_module_function::RULE, Severity::Warn)
                .unwrap();
            config.set_module_function_scope(scope);
            let allocator = Allocator::default();
            let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
            assert!(parsed.diagnostics.is_empty(), "test source must parse");
            let diagnostics = run(
                &parsed.program,
                &Source { path: Path::new("fixture.tsx"), text: source },
                &config,
                false,
            );
            assert_eq!(
                diagnostics.iter().map(|d| d.rule.as_str()).collect::<Vec<_>>(),
                [allocations::require_module_function::RULE]
            );
            assert_eq!(diagnostics[0].severity, Severity::Warn);
        }
    }
}
