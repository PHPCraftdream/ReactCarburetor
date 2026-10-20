use super::*;
use crate::config::Severity;
use crate::rules::support::walk::{walk_rules, Rule};
use std::collections::HashSet;

pub(super) fn run(
    program: &Program<'_>,
    source: &Source<'_>,
    config: &Config,
    keep_overlaps: bool,
    shared: bool,
) -> Vec<Diagnostic> {
    if !shared {
        return super::run_sequential(program, source, config, keep_overlaps);
    }

    let bases = support::bases::Bases::from_config(
        config.extra_component_bases(),
        config.extra_store_bases(),
    );
    let module_scope = config.module_function_scope();
    let semantic_rules = [
        allocations::require_method_for_closure::RULE,
        allocations::require_module_function::RULE,
        lifecycle::no_handler_created_in_render::RULE,
        lifecycle::no_function_in_render::RULE,
        data::interop::no_memo_over_store_read::RULE,
        data::interop::no_capturing_hook_selector::RULE,
        allocations::no_closure_in_update::RULE,
        boundaries::no_async_transaction::RULE,
        effects::no_async_effect::RULE,
        allocations::no_react_hooks_in_components::RULE,
        data::writes::no_store_write_in_render::RULE,
        boundaries::require_subscription_disposal::RULE,
        boundaries::one_export_per_file::RULE,
    ];
    let semantic = semantic_rules
        .iter()
        .any(|rule| config.severity(rule) != Severity::Off)
        .then(|| support::closures::build_semantic(program));

    let mut buckets: Vec<Vec<Diagnostic>> = (0..REGISTRY.len()).map(|_| Vec::new()).collect();
    // One analysis per member serves both allocation rules; it lives as long as the walk below.
    let cache = support::closures::MemberCache::default();
    let mut rules: Vec<(usize, Box<dyn Rule<'_> + '_>)> = Vec::new();
    for (index, (rule, check, shared_factory)) in REGISTRY.iter().enumerate() {
        let severity = config.severity(rule);
        if severity == Severity::Off || !super::rule_possible(rule, source.text, &bases) {
            continue;
        }
        let built: Option<Box<dyn Rule<'_>>> = match *rule {
            allocations::no_closure_in_update::RULE => {
                Some(Box::new(allocations::no_closure_in_update::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                )))
            }
            allocations::require_method_for_closure::RULE => Some(Box::new(
                allocations::require_method_for_closure::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                    &bases,
                    &cache,
                ),
            )),
            allocations::require_module_function::RULE => {
                Some(Box::new(allocations::require_module_function::make_rule(
                    program,
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                    &bases,
                    &cache,
                )))
            }
            lifecycle::no_function_in_render::RULE => {
                Some(Box::new(lifecycle::no_function_in_render::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                )))
            }
            lifecycle::no_handler_created_in_render::RULE => Some(Box::new(
                lifecycle::no_handler_created_in_render::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                    support::closures::CaptureIndex::new(
                        semantic
                            .as_ref()
                            .expect("enabled rule has shared semantics"),
                    ),
                ),
            )),
            data::writes::no_store_write_in_render::RULE => {
                Some(Box::new(data::writes::no_store_write_in_render::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                )))
            }
            data::interop::no_memo_over_store_read::RULE => {
                Some(Box::new(data::interop::no_memo_over_store_read::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                )))
            }
            data::interop::no_capturing_hook_selector::RULE => Some(Box::new(
                data::interop::no_capturing_hook_selector::make_rule(
                    source,
                    semantic
                        .as_ref()
                        .expect("enabled rule has shared semantics"),
                ),
            )),
            boundaries::max_render_depth::RULE => Some(Box::new(
                boundaries::max_render_depth::make_rule(source, config.max_render_depth()),
            )),
            lifecycle::no_lifecycle_class_property::RULE => Some(Box::new(
                lifecycle::no_lifecycle_class_property::make_rule(source),
            )),
            effects::no_async_effect::RULE => Some(Box::new(effects::no_async_effect::make_rule(
                source,
                semantic
                    .as_ref()
                    .expect("enabled rule has shared semantics"),
            ))),
            effects::no_duplicate_effect_name::RULE => Some(Box::new(
                effects::no_duplicate_effect_name::make_rule(source),
            )),
            data::writes::no_direct_data_write::RULE => Some(Box::new(
                data::writes::no_direct_data_write::make_rule(source),
            )),
            data::writes::no_external_data_mutation::RULE => Some(Box::new(
                data::writes::no_external_data_mutation::make_rule(source),
            )),
            data::writes::no_tracked_data_mutation::RULE => Some(Box::new(
                data::writes::no_tracked_data_mutation::make_rule(source),
            )),
            data::writes::no_untrackable_draft_mutation::RULE => Some(Box::new(
                data::writes::no_untrackable_draft_mutation::make_rule(source),
            )),
            data::writes::require_emit_after_draft_write::RULE => Some(Box::new(
                data::writes::require_emit_after_draft_write::make_rule(source),
            )),
            data::reads::no_computed_get_in_render::RULE => Some(Box::new(
                data::reads::no_computed_get_in_render::make_rule(source),
            )),
            data::reads::no_get_data_in_render::RULE => Some(Box::new(
                data::reads::no_get_data_in_render::make_rule(source),
            )),
            data::reads::no_escaping_tracked_data::RULE => Some(Box::new(
                data::reads::no_escaping_tracked_data::make_rule(source),
            )),
            data::reads::no_use_carburetor_outside_render::RULE => Some(Box::new(
                data::reads::no_use_carburetor_outside_render::make_rule(source),
            )),
            data::reads::no_computed_get_in_computed::RULE => Some(Box::new(
                data::reads::no_computed_get_in_computed::make_rule(source),
            )),
            _ => None,
        };

        if *shared_factory {
            let rule_impl = built.expect("shared registry rule must have a dispatch factory");
            rules.push((index, rule_impl));
        } else if built.is_some() {
            unreachable!("dispatch factory is missing its shared registry marker: {rule}");
        } else if semantic_rules.contains(rule) {
            buckets[index].extend(crate::rules::shared::check_with_shared(
                rule,
                program,
                source,
                semantic.as_ref(),
                module_scope,
                &bases,
            ));
        } else {
            // The rules with options read them here too, so a configured limit or root set
            // behaves identically on both dispatch paths.
            buckets[index].extend(match *rule {
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
            });
        }
    }

    if !rules.is_empty() {
        let reports = {
            let mut refs = Vec::new();
            for (_, rule_impl) in rules.iter_mut() {
                refs.push(&mut **rule_impl as &mut dyn Rule<'_>);
            }
            walk_rules(program, refs, &bases)
        };
        for diagnostic in reports {
            if let Some(index) = REGISTRY
                .iter()
                .position(|(rule, _, _)| *rule == diagnostic.rule)
            {
                buckets[index].push(diagnostic);
            }
        }
    }

    let module_index = REGISTRY
        .iter()
        .position(|(rule, _, _)| *rule == allocations::require_module_function::RULE)
        .expect("module function rule is registered");
    if config.severity(allocations::require_module_function::RULE) != Severity::Off
        && super::rule_possible(
            allocations::require_module_function::RULE,
            source.text,
            &bases,
        )
    {
        if let Some(semantic) = semantic.as_ref() {
            buckets[module_index] = allocations::require_module_function::finish_rule(
                std::mem::take(&mut buckets[module_index]),
                program,
                source,
                semantic,
                module_scope,
            );
        }
    }

    let mut diagnostics = Vec::new();
    for (index, bucket) in buckets.iter_mut().enumerate() {
        let severity = config.severity(REGISTRY[index].0);
        for diagnostic in bucket.iter_mut() {
            diagnostic.severity = severity;
        }
        diagnostics.append(bucket);
    }
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
