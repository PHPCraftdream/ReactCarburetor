//! What a rule's unit tests need: parse a snippet, run one rule, look at what it reported.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::{Diagnostic, Source};

/// Runs one rule over a TSX snippet and returns what it reported.
///
/// TSX for every test, because it is the superset the real files are written in — a rule that only
/// works on plain TypeScript would pass its tests and then miss half the components.
pub fn diagnose(
    text: &str,
    check: fn(
        &oxc_ast::ast::Program<'_>,
        &Source<'_>,
        &crate::rules::support::bases::Bases,
    ) -> Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    diagnose_with(text, &crate::rules::support::bases::Bases::default(), check)
}

/// The same, with explicit base lists, for tests of configured recognition.
pub fn diagnose_with(
    text: &str,
    bases: &crate::rules::support::bases::Bases,
    check: fn(
        &oxc_ast::ast::Program<'_>,
        &Source<'_>,
        &crate::rules::support::bases::Bases,
    ) -> Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );

    let path = Path::new("fixture.tsx");
    let source = Source::new(path, text);

    check(&parsed.program, &source, bases)
}

/// The 1-based lines a rule reported on, in order — what a test asserts against.
pub fn lines(diagnostics: &[Diagnostic]) -> Vec<usize> {
    diagnostics
        .iter()
        .map(|diagnostic| diagnostic.line)
        .collect()
}

#[cfg(test)]
mod registry {

use std::path::Path;

    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

use crate::config::{Config, ModuleFunctionScope, Severity};
use crate::rules::{allocations, boundaries, data, effects, lifecycle, rule_possible, run, Diagnostic, Source};
use crate::rules::support::bases::Bases;

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
            &Source::new(Path::new("fixture.tsx"), text),
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
        assert!(rule_possible(
            lifecycle::require_bind_for_passed_method::RULE,
            source,
            &Bases::default(),
        ));
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
            .override_rule(
                allocations::require_method_for_closure::RULE,
                Severity::Warn,
            )
            .unwrap();
        config
            .override_rule(allocations::require_module_function::RULE, Severity::Warn)
            .unwrap();
        config.set_module_function_scope(ModuleFunctionScope::Classes);

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let classes_only = run(
            &parsed.program,
            &Source::new(Path::new("fixture.tsx"), source),
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
        assert!(!rule_possible(
            lifecycle::require_bind_for_passed_method::RULE,
            source,
            &Bases::default(),
        ));
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
        assert_eq!(lines(allocations::require_method_for_closure::RULE), [4]);

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
                .override_rule(
                    allocations::require_method_for_closure::RULE,
                    Severity::Warn,
                )
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
                &Source::new(Path::new("fixture.tsx"), source),
                &config,
                false,
            );
            assert_eq!(
                diagnostics
                    .iter()
                    .map(|d| d.rule.as_str())
                    .collect::<Vec<_>>(),
                [allocations::require_module_function::RULE]
            );
            assert_eq!(diagnostics[0].severity, Severity::Warn);
        }
    }

    #[test]
    fn prefilter_marker_groups_match_each_rules_real_requirements() {
        let bases = Bases::default();
        let possible = |rule: &str, text: &str| rule_possible(rule, text, &bases);

        // A store rule needs a store marker and its own call/member marker.
        assert!(possible(
            allocations::no_closure_in_update::RULE,
            "class C extends Carburetor { m() { this.update(() => x); } }"
        ));
        assert!(!possible(
            allocations::no_closure_in_update::RULE,
            "class C { m() { this.update(() => x); } }"
        ));
        assert!(!possible(
            allocations::no_closure_in_update::RULE,
            "class C extends Carburetor { m() { run(); } }"
        ));

        // The module-level-store rule also reports the naming convention on its own.
        assert!(possible(
            boundaries::no_module_level_store::RULE,
            "const s = new TodoCarburetor(api);"
        ));
        assert!(possible(
            boundaries::no_module_level_store::RULE,
            "export const users = new ResourceCache(load);"
        ));
        assert!(!possible(
            boundaries::no_module_level_store::RULE,
            "const thing = new Thing(api);"
        ));

        // Lifecycle rules need a component base and a lifecycle name.
        let lifecycle =
            "class W extends AntiHookComponent { componentDidMount() { super.componentDidMount(); } }";
        assert!(possible(
            lifecycle::require_super_in_lifecycle::RULE,
            lifecycle
        ));
        assert!(!possible(
            lifecycle::require_super_in_lifecycle::RULE,
            "class W extends AntiHookComponent { tick() {} }"
        ));

        // Effect rules name useEffect; transaction names either batching API.
        assert!(!possible(
            effects::no_async_effect::RULE,
            "export const tap = (fn) => fn();"
        ));
        assert!(possible(
            boundaries::no_async_transaction::RULE,
            "store.update(async () => {});"
        ));
        assert!(possible(
            boundaries::no_async_transaction::RULE,
            "transaction(async () => {});"
        ));

        // Rules without a static marker are never prefiltered.
        assert!(possible(allocations::require_module_function::RULE, ""));
        assert!(possible(lifecycle::no_function_in_render::RULE, ""));

        // An escaped identifier disables the prefilter for the whole file.
        assert!(possible(
            data::writes::require_emit_after_draft_write::RULE,
            "class C extends Carburetor { m() { this.draft.x = 1; } }"
        ));
    }

    #[test]
    fn configured_bases_widen_the_prefilter_with_the_recognition() {
        let component = [String::from("AppComponent")];
        let store = [String::from("UsersCache")];
        let bases = Bases::from_config(&component, &store);

        assert!(rule_possible(
            lifecycle::require_bind_for_passed_method::RULE,
            "class Row extends AppComponent {}",
            &bases,
        ));
        assert!(rule_possible(
            boundaries::no_untrackable_store_data::RULE,
            "class UsersCache extends UsersCache {}",
            &bases,
        ));
        assert!(!rule_possible(
            lifecycle::require_bind_for_passed_method::RULE,
            "class Row extends AppComponent {}",
            &Bases::default(),
        ));
    }
}
