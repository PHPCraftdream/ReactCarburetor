use super::*;
use crate::config::ImportRoot;
use crate::fix;
use crate::rules::support::testing::lines;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::path::Path;

/// The library tree the JavaScript rule defaulted to; the cases below reuse its paths.
fn library_roots() -> Vec<ImportRoot> {
    vec![
        ImportRoot {
            path: String::from("lib/src"),
            prefix: String::from("@/"),
        },
        ImportRoot {
            path: String::from("plugin/src"),
            prefix: String::from("@plugin/"),
        },
    ]
}

/// Parses a snippet and runs the rule at explicit roots, from an explicit file path, since both
/// live outside `check`'s registry signature.
fn diagnose_from(filename: &str, text: &str, roots: &[ImportRoot]) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );

    let path = Path::new(filename);
    let source = Source::new(path, text);

    check_with_options(&parsed.program, &source, roots)
}

/// The source after applying whatever fixes the rule suggested, when all of them apply.
fn fixed_from(filename: &str, text: &str, roots: &[ImportRoot]) -> String {
    let diagnostics = diagnose_from(filename, text, roots);
    let fixes = diagnostics
        .iter()
        .filter_map(|diagnostic| diagnostic.fix.as_ref());

    fix::apply(text, fixes.collect()).expect("every case here expects its fixes to apply")
}

/// `check` at the JavaScript rule's default roots reports nothing on these files: a sibling, a
/// downward reach, an aliased import, a package import and an exit from the tree are all fine.
fn silent(filename: &str, text: &str) {
    assert_eq!(
        lines(&diagnose_from(filename, text, &library_roots())),
        [] as [usize; 0]
    );
}

#[test]
fn a_sibling_import_stays_relative() {
    silent(
        "lib/src/Carburetor/Store/Paths/joinPath.ts",
        "import {PATH_SEPARATOR} from \"./PathSeparator\";",
    );
}

#[test]
fn a_downward_import_stays_relative() {
    silent(
        "lib/src/Carburetor/index.ts",
        "export * from './Store/Carburetor';",
    );
}

#[test]
fn an_import_already_written_through_the_alias_stays() {
    silent(
        "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts",
        "import {joinPath} from \"@/Carburetor/Store/Paths/joinPath\";",
    );
}

#[test]
fn a_package_import_stays() {
    silent(
        "lib/src/Carburetor/Component/AntiHookComponent/AntiHookComponent.tsx",
        "import * as React from \"react\";",
    );
}

#[test]
fn an_import_that_leaves_the_source_tree_has_no_aliased_form() {
    silent(
        "perf/scenarios/subscribe/match-precision.mjs",
        "import {load} from \"../../harness/lib.mjs\";",
    );
}

#[test]
fn one_level_up_inside_the_library_is_reported_and_fixed() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";
    let text = "import {joinPath} from \"../Paths/joinPath\";";

    let diagnostics = diagnose_from(filename, text, &library_roots());

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "\"../Paths/joinPath\" reaches up out of this directory. Import it as \
         \"@/Carburetor/Store/Paths/joinPath\", which names the module from the root of the \
         source tree and survives the file being moved."
    );
    assert_eq!(
        fixed_from(filename, text, &library_roots()),
        "import {joinPath} from \"@/Carburetor/Store/Paths/joinPath\";"
    );
}

#[test]
fn single_quotes_stay_single_quotes() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";

    assert_eq!(
        fixed_from(
            filename,
            "import {joinPath} from '../Paths/joinPath';",
            &library_roots()
        ),
        "import {joinPath} from '@/Carburetor/Store/Paths/joinPath';"
    );
}

#[test]
fn a_quote_inside_the_path_is_escaped_in_the_kept_quote_style() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";

    assert_eq!(
        fixed_from(
            filename,
            "import value from '../Utils/it\\'s';",
            &library_roots(),
        ),
        "import value from '@/Carburetor/Store/Utils/it\\'s';"
    );
}

#[test]
fn a_backslash_in_the_path_is_escaped_too() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";

    // The resolved alias carries the written backslash through; the fix doubles it so the
    // escaping survives the rewrite.
    assert_eq!(
        fixed_from(
            filename,
            "import value from '../Utils/with\\\\slash';",
            &library_roots(),
        ),
        "import value from '@/Carburetor/Store/Utils/with\\\\slash';"
    );
}

#[test]
fn two_levels_up_is_fixed() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";

    assert_eq!(
        fixed_from(
            filename,
            "import {TPath} from \"../../Models/Paths\";",
            &library_roots()
        ),
        "import {TPath} from \"@/Carburetor/Models/Paths\";"
    );
}

#[test]
fn a_re_export_is_fixed() {
    let filename = "lib/src/Carburetor/Store/Paths/index.ts";

    assert_eq!(
        fixed_from(
            filename,
            "export * from \"../../Models/Paths\";",
            &library_roots()
        ),
        "export * from \"@/Carburetor/Models/Paths\";"
    );
}

#[test]
fn a_named_re_export_is_fixed() {
    let filename = "lib/src/Carburetor/Store/Paths/index.ts";

    assert_eq!(
        fixed_from(
            filename,
            "export {TPath} from \"../../Models/Paths\";",
            &library_roots()
        ),
        "export {TPath} from \"@/Carburetor/Models/Paths\";"
    );
}

#[test]
fn the_plugin_tree_gets_its_own_alias() {
    let filename = "plugin/src/Rules/Writes/noDirectDataWrite.mts";

    assert_eq!(
        fixed_from(
            filename,
            "import {describeChainRoot} from \"../../Utils/Ast/describeChainRoot.mts\";",
            &library_roots(),
        ),
        "import {describeChainRoot} from \"@plugin/Utils/Ast/describeChainRoot.mts\";"
    );
}

#[test]
fn a_test_reaching_into_the_library_is_fixed() {
    assert_eq!(
        fixed_from(
            "__tests__/Engine/Store/Carburetor.test.ts",
            "import {Carburetor} from \"../../../lib/src/Carburetor\";",
            &library_roots(),
        ),
        "import {Carburetor} from \"@/Carburetor\";"
    );
}

#[test]
fn every_offending_import_in_the_file_is_fixed() {
    let filename = "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts";
    let text = "import {TPath} from \"../../Models/Paths\";\n\
                import {joinPath} from \"../Paths/joinPath\";";

    let diagnostics = diagnose_from(filename, text, &library_roots());

    assert_eq!(lines(&diagnostics), [1, 2]);
    assert_eq!(
        fixed_from(filename, text, &library_roots()),
        "import {TPath} from \"@/Carburetor/Models/Paths\";\n\
         import {joinPath} from \"@/Carburetor/Store/Paths/joinPath\";"
    );
}

#[test]
fn roots_can_be_renamed_through_options() {
    let roots = [ImportRoot {
        path: String::from("app/source"),
        prefix: String::from("~/"),
    }];

    assert_eq!(
        fixed_from(
            "app/source/Feature/Row.ts",
            "import {store} from \"../Stores/store\";",
            &roots
        ),
        "import {store} from \"~/Stores/store\";"
    );
}

#[test]
fn an_offending_import_without_configured_roots_stays_silent() {
    // With no roots the rule cannot name an alias, so it stays silent rather than reporting a
    // violation with no way forward.
    assert_eq!(
        lines(&diagnose_from(
            "lib/src/Carburetor/Store/Tracking/createWriteProxy.ts",
            "import {joinPath} from \"../Paths/joinPath\";",
            &[]
        )),
        [] as [usize; 0]
    );
}
