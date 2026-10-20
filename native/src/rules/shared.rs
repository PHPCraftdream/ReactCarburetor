//! The one dispatcher for the rules that share a semantic pass; `None` means every one of
//! them is off.

use super::*;

/// Runs the rules that share one semantic pass; `None` means every one of them is off.
pub(super) fn check_with_shared<'a>(
    rule: &str,
    program: &'a Program<'a>,
    source: &Source<'_>,
    semantic: Option<&'a oxc_semantic::Semantic<'a>>,
    module_scope: crate::config::ModuleFunctionScope,
    bases: &'a support::bases::Bases,
) -> Vec<Diagnostic> {
    let Some(semantic) = semantic else {
        return Vec::new();
    };
    match rule {
        allocations::require_method_for_closure::RULE => {
            allocations::require_method_for_closure::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        allocations::require_module_function::RULE => {
            allocations::require_module_function::check_with_semantic(
                program,
                source,
                semantic,
                module_scope,
                bases,
            )
        }
        lifecycle::no_handler_created_in_render::RULE => {
            lifecycle::no_handler_created_in_render::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        lifecycle::no_function_in_render::RULE => {
            lifecycle::no_function_in_render::check_with_semantic(program, source, semantic, bases)
        }
        data::interop::no_memo_over_store_read::RULE => {
            data::interop::no_memo_over_store_read::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        data::interop::no_capturing_hook_selector::RULE => {
            data::interop::no_capturing_hook_selector::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        allocations::no_closure_in_update::RULE => {
            allocations::no_closure_in_update::check_with_semantic(program, source, semantic, bases)
        }
        boundaries::no_async_transaction::RULE => {
            boundaries::no_async_transaction::check_with_semantic(program, source, semantic)
        }
        effects::no_async_effect::RULE => {
            effects::no_async_effect::check_with_semantic(program, source, semantic)
        }
        allocations::no_react_hooks_in_components::RULE => {
            allocations::no_react_hooks_in_components::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        data::writes::no_store_write_in_render::RULE => {
            data::writes::no_store_write_in_render::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        boundaries::one_export_per_file::RULE => {
            boundaries::one_export_per_file::check_with_semantic(program, source, semantic)
        }
        boundaries::require_subscription_disposal::RULE => {
            boundaries::require_subscription_disposal::check_with_semantic(
                program, source, semantic, bases,
            )
        }
        _ => Vec::new(),
    }
}
