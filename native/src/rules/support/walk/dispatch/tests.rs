use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::config::{Config, ModuleFunctionScope, Severity};
use crate::rules::{
    allocations, data, run_internal,
    support::{closures, walk},
};
use crate::Source;

const CORPUS: &[&str] = &[
    include_str!("../../../../../tests/fixtures/offender.tsx"),
    include_str!("../../../../../tests/fixtures/clean.tsx"),
    include_str!("../../../../../tests/fixtures/tree/app.tsx"),
];

fn serialized(text: &str, config: &Config, overlaps: bool, shared: bool) -> String {
    let allocator = Allocator::default();
    let result = Parser::new(&allocator, text, SourceType::tsx()).parse();
    assert!(
        result.diagnostics.is_empty(),
        "corpus must parse: {:?}",
        result.diagnostics
    );
    let diagnostics = run_internal(
        &result.program,
        &Source::new(Path::new("fixture.tsx"), text),
        config,
        overlaps,
        shared,
    );
    serde_json::to_string(&diagnostics).unwrap()
}

#[test]
fn shared_dispatch_matches_sequential_serialized_diagnostics() {
    let configurations = [
        Config::default(),
        {
            let mut c = Config::default();
            c.override_rule(
                allocations::require_method_for_closure::RULE,
                Severity::Warn,
            )
            .unwrap();
            c
        },
        {
            let mut c = Config::default();
            c.override_rule(allocations::require_method_for_closure::RULE, Severity::Off)
                .unwrap();
            c
        },
    ];
    for source in CORPUS {
        for config in &configurations {
            for overlaps in [false, true] {
                assert_eq!(
                    serialized(source, config, overlaps, true),
                    serialized(source, config, overlaps, false)
                );
            }
        }
    }
    let mut all_scope = Config::default();
    all_scope.set_module_function_scope(ModuleFunctionScope::Classes);
    for source in CORPUS {
        assert_eq!(
            serialized(source, &all_scope, false, true),
            serialized(source, &all_scope, false, false)
        );
    }
}

#[test]
fn dispatch_walk_and_semantic_work_is_bounded_and_skips_disabled_rules() {
    let text = "class A extends AntiHookComponent { render(){ return this.x.map(x => () => x); } }";
    let allocator = Allocator::default();
    let result = Parser::new(&allocator, text, SourceType::tsx()).parse();
    assert!(
        result.diagnostics.is_empty(),
        "test source must parse: {:?}",
        result.diagnostics
    );
    let source = Source::new(Path::new("fixture.tsx"), text);
    let mut config = Config::default();
    walk::reset_test_counts();
    closures::reset_semantic_test_count();
    run_internal(&result.program, &source, &config, false, true);
    let (walks, participating) = walk::test_counts();
    assert_eq!(walks, 1);
    assert!(participating > 1);
    assert_eq!(closures::semantic_test_count(), 1);

    walk::reset_test_counts();
    closures::reset_semantic_test_count();
    run_internal(&result.program, &source, &config, false, false);
    assert!(walk::test_counts().0 > 1);
    assert_eq!(closures::semantic_test_count(), 1);

    config
        .override_rule(allocations::require_method_for_closure::RULE, Severity::Off)
        .unwrap();
    walk::reset_test_counts();
    closures::reset_semantic_test_count();
    run_internal(&result.program, &source, &config, false, true);
    let (reduced_walks, reduced_participating) = walk::test_counts();
    assert_eq!(reduced_walks, 1);
    assert!(reduced_participating < participating);
    assert_eq!(closures::semantic_test_count(), 1);

    walk::reset_test_counts();
    closures::reset_semantic_test_count();
    for (rule, _, _) in super::REGISTRY {
        config.override_rule(rule, Severity::Off).unwrap();
    }
    run_internal(&result.program, &source, &config, false, true);
    assert_eq!(walk::test_counts(), (0, 0));
    assert_eq!(closures::semantic_test_count(), 0);
    let mut only_get_data = Config::default();
    for (rule, _, _) in super::REGISTRY {
        only_get_data.override_rule(rule, Severity::Off).unwrap();
    }
    only_get_data
        .override_rule(data::reads::no_get_data_in_render::RULE, Severity::Error)
        .unwrap();
    let component_without_marker =
        "class A extends AntiHookComponent { render(){ return this.x; } }";
    let component_with_marker =
        "class A extends AntiHookComponent { render(){ return this.getData(); } }";
    for text in [component_without_marker, component_with_marker] {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty());
        walk::reset_test_counts();
        closures::reset_semantic_test_count();
        run_internal(
            &parsed.program,
            &Source::new(Path::new("fixture.tsx"), text),
            &only_get_data,
            false,
            true,
        );
        let (walks, participants) = walk::test_counts();
        assert_eq!(walks, usize::from(text == component_with_marker));
        assert_eq!(participants, walks);
        assert_eq!(closures::semantic_test_count(), 0);
    }
}
