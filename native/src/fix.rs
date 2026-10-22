//! One rule's suggested edit, and the two things every consumer of one needs: resolving overlaps
//! between several edits in the same file, and writing the result without ever leaving a
//! half-written file behind if the process dies mid-write.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::Serialize;

use crate::config::{Config, Severity};
use crate::source::analyze;
use crate::{Diagnostic, FixMode, MAX_FIX_PASSES};

/// Replace the byte range `[start, end)` of the file's source with `text`. Offsets are the same
/// byte offsets a rule already reports at, so a rule builds one from spans it already has.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Fix {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

/// Applies as many of `fixes` as do not overlap, keeping the one that starts first of any pair
/// that does. The loser is simply left out of the result — once the winner has shifted the text
/// around it, a later pass over the re-parsed file sees the loser's violation at new offsets and
/// can fix it then. Returns `None` when none of the fixes could be applied (there weren't any, or
/// every one of them overlapped an earlier one).
pub fn apply(source: &str, mut fixes: Vec<&Fix>) -> Option<String> {
    fixes.sort_by_key(|fix| (fix.start, fix.end));

    let mut result = String::with_capacity(source.len());
    let mut cursor = 0u32;
    let mut applied_any = false;

    for fix in fixes {
        if fix.start < cursor {
            continue;
        }

        result.push_str(&source[cursor as usize..fix.start as usize]);
        result.push_str(&fix.text);
        cursor = fix.end;
        applied_any = true;
    }

    if !applied_any {
        return None;
    }

    result.push_str(&source[cursor as usize..]);

    Some(result)
}

/// Writes `text` to `path` so that a process dying mid-write leaves the original file intact: the
/// new content lands in a sibling temporary file first, and only a single rename — atomic on every
/// platform this runs on — ever touches `path` itself. The original file's permissions are carried
/// over, so an executable file stays executable, while a read-only original makes the rename fail
/// loudly rather than being silently replaced by a writable file.
pub fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    let mut temp_name = path.as_os_str().to_os_string();
    temp_name.push(".carburetor-fix.tmp");
    let temp_path = Path::new(&temp_name).to_path_buf();

    fs::write(&temp_path, text)?;

    let carry = match fs::metadata(path) {
        Ok(metadata) => fs::set_permissions(&temp_path, metadata.permissions()),
        // The original is gone; a default-permission replacement is the best that remains.
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    };

    if let Err(error) = carry {
        let _ = fs::remove_file(&temp_path);

        return Err(error);
    }

    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);

            Err(error)
        }
    }
}

/// A preview of what [`write_atomically`] would do, for `--fix-dry-run`: the lines that differ
/// between `old` and `new`, framed by the longest unchanged prefix and suffix. This is not a full
/// diff algorithm — it does not re-align matching lines inside the changed region — but a
/// mechanical fix changes one small, contiguous span of a file, which is exactly the shape this
/// handles exactly.
pub fn diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();

    let max_common = old_lines.len().min(new_lines.len());

    let mut prefix = 0;
    while prefix < max_common && old_lines[prefix] == new_lines[prefix] {
        prefix += 1;
    }

    let mut suffix = 0;
    while suffix < max_common - prefix
        && old_lines[old_lines.len() - 1 - suffix] == new_lines[new_lines.len() - 1 - suffix]
    {
        suffix += 1;
    }

    let mut out = String::new();

    for line in &old_lines[prefix..old_lines.len() - suffix] {
        out.push_str("- ");
        out.push_str(line);
        out.push('\n');
    }

    for line in &new_lines[prefix..new_lines.len() - suffix] {
        out.push_str("+ ");
        out.push_str(line);
        out.push('\n');
    }

    out
}

/// One file's outcome after `--fix`'s pass loop: the diagnostics that remain, and — when the text
/// actually changed — the before and after, for [`run_fix`] to either write or preview.
struct FixOutcome {
    diagnostics: Vec<Diagnostic>,
    change: Option<(String, String)>,
}

/// Re-parses and re-runs the rules over `text` after every fix, applying at most one round of
/// non-overlapping fixes per pass, until nothing fixable remains or [`MAX_FIX_PASSES`] is reached.
/// A fix that turns out to have broken parsing is discarded rather than published: `compute`
/// returning `None` stops the loop on the last text that was known to parse, and that text's own
/// (pre-fix) diagnostics are what gets reported for it.
pub(crate) fn stabilize(
    text: String,
    mut compute: impl FnMut(&str) -> Option<Vec<Diagnostic>>,
) -> (String, Vec<Diagnostic>) {
    let mut text = text;
    let mut diagnostics = compute(&text).unwrap_or_default();

    for _ in 0..MAX_FIX_PASSES {
        let fixes: Vec<&Fix> = diagnostics
            .iter()
            .filter_map(|diagnostic| diagnostic.fix.as_ref())
            .collect();

        if fixes.is_empty() {
            break;
        }

        let Some(candidate) = apply(&text, fixes) else {
            break;
        };

        if candidate == text {
            break;
        }

        match compute(&candidate) {
            Some(next) => {
                text = candidate;
                diagnostics = next;
            }
            None => break,
        }
    }

    (text, diagnostics)
}

/// Runs the fix loop for one file; read failures retain the path for the run-level error.
fn fix_one_file(
    path: &Path,
    config: &Config,
    cli: &[(String, Severity)],
    keep_overlaps: bool,
) -> Result<FixOutcome, String> {
    let mut config = config.overrides_for(path);
    for (rule, severity) in cli {
        config
            .override_rule(rule, *severity)
            .map_err(|error| error.to_string())?;
    }
    let original = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;

    let (final_text, diagnostics) = stabilize(original.clone(), |text| {
        analyze(path, text, &config, keep_overlaps)
    });
    let change = (final_text != original).then_some((original, final_text));

    Ok(FixOutcome {
        diagnostics,
        change,
    })
}

/// Runs the fix loop over every file, writing or previewing each change as it goes.
pub(crate) fn run_fix(
    files: &[PathBuf],
    config: &Config,
    mode: FixMode,
    cli: &[(String, Severity)],
    keep_overlaps: bool,
) -> Result<Vec<Diagnostic>, String> {
    // One task per file, the same reasoning as the plain check: parsing dominates the work.
    let outcomes: Vec<(&PathBuf, FixOutcome)> = files
        .par_iter()
        .map(|path| fix_one_file(path, config, cli, keep_overlaps).map(|outcome| (path, outcome)))
        .collect::<Result<Vec<_>, _>>()?;

    let mut diagnostics = Vec::new();

    for (path, outcome) in outcomes {
        if let Some((original, final_text)) = &outcome.change {
            match mode {
                FixMode::Write => write_atomically(path, final_text)
                    .map_err(|error| format!("could not write {}: {error}", path.display()))?,
                FixMode::DryRun => {
                    println!("--- {}", path.display());
                    print!("{}", diff(original, final_text));
                }
                FixMode::Report => unreachable!("run_fix only runs for Write or DryRun"),
            }
        }

        diagnostics.extend(outcome.diagnostics);
    }

    Ok(diagnostics)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Severity;

    fn fix(start: u32, end: u32, text: &str) -> Fix {
        Fix { start, end, text: text.to_string() }
    }

    fn diagnostic_with_fix(fix: Fix) -> Diagnostic {
        Diagnostic {
            file: "fixture.tsx".to_string(),
            line: 1,
            column: 1,
            rule: "carburetor/test-rule".to_string(),
            message: "test".to_string(),
            severity: Severity::Error,
            fix: Some(fix),
            scope: None,
        }
    }

    #[test]
    fn stabilize_stops_once_nothing_is_fixable() {
        let (text, diagnostics) = stabilize("clean".to_string(), |_| Some(Vec::new()));

        assert_eq!(text, "clean");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn stabilize_applies_a_fix_and_recomputes_once() {
        let (text, diagnostics) = stabilize("old".to_string(), |current| {
            if current == "old" {
                Some(vec![diagnostic_with_fix(Fix {
                    start: 0,
                    end: 3,
                    text: "new".to_string(),
                })])
            } else {
                Some(Vec::new())
            }
        });

        assert_eq!(text, "new");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn stabilize_never_exceeds_the_pass_limit_when_a_fix_keeps_reporting_itself() {
        // A pathological fix that flips the text forever and reports a violation every time: proof
        // the loop stops on its own rather than hanging the tool.
        let mut calls = 0u32;

        let (text, diagnostics) = stabilize("a".to_string(), |current| {
            calls += 1;
            let flipped = if current == "a" { "b" } else { "a" };

            Some(vec![diagnostic_with_fix(Fix {
                start: 0,
                end: current.len() as u32,
                text: flipped.to_string(),
            })])
        });

        assert_eq!(
            calls,
            MAX_FIX_PASSES + 1,
            "one initial computation, then one per pass"
        );
        assert!(
            !diagnostics.is_empty(),
            "the oscillating rule never actually stabilizes"
        );
        assert!(text == "a" || text == "b");
    }

    #[test]
    fn a_fix_that_breaks_parsing_is_discarded() {
        let (text, diagnostics) = stabilize("good".to_string(), |current| {
            if current == "good" {
                // Reports a fix, but validating the candidate ("broken") fails to parse.
                Some(vec![diagnostic_with_fix(Fix {
                    start: 0,
                    end: 4,
                    text: "broken".to_string(),
                })])
            } else {
                None
            }
        });

        assert_eq!(text, "good", "the last text known to parse is kept");
        assert_eq!(
            diagnostics.len(),
            1,
            "the pre-fix diagnostics are what gets reported"
        );
    }

    #[test]
    fn two_overlapping_fixes_need_two_passes_to_both_land() {
        // "XY": pass 1 offers two overlapping fixes ([0,1) and [0,2)); apply() keeps only the
        // first, producing "1Y". Pass 2 offers a fresh, now non-overlapping fix for what is left.
        let (text, diagnostics) = stabilize("XY".to_string(), |current| match current {
            "XY" => Some(vec![
                diagnostic_with_fix(Fix {
                    start: 0,
                    end: 1,
                    text: "1".to_string(),
                }),
                diagnostic_with_fix(Fix {
                    start: 0,
                    end: 2,
                    text: "22".to_string(),
                }),
            ]),
            "1Y" => Some(vec![diagnostic_with_fix(Fix {
                start: 1,
                end: 2,
                text: "2".to_string(),
            })]),
            _ => Some(Vec::new()),
        });

        assert_eq!(text, "12");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn a_single_fix_applies_cleanly() {
        let source = "let x = old;";
        let replacement = fix(8, 11, "new");

        assert_eq!(apply(source, vec![&replacement]), Some("let x = new;".to_string()));
    }

    #[test]
    fn no_fixes_is_no_change() {
        assert_eq!(apply("unchanged", Vec::new()), None);
    }

    #[test]
    fn two_disjoint_fixes_both_apply_in_one_pass() {
        let source = "aaa bbb";
        let first = fix(0, 3, "XXX");
        let second = fix(4, 7, "YYY");

        assert_eq!(apply(source, vec![&first, &second]), Some("XXX YYY".to_string()));
    }

    #[test]
    fn of_two_overlapping_fixes_only_the_earlier_starting_one_applies() {
        let source = "abcdef";
        // [0, 4) and [2, 6) overlap; the second's start falls inside the first's range.
        let earlier = fix(0, 4, "1234");
        let later = fix(2, 6, "5678");

        let result = apply(source, vec![&later, &earlier]);

        assert_eq!(result, Some("1234ef".to_string()), "the later-starting fix is left for a later pass");
    }

    #[test]
    fn overlap_resolution_does_not_depend_on_input_order() {
        let source = "abcdef";
        let earlier = fix(0, 4, "1234");
        let later = fix(2, 6, "5678");

        assert_eq!(apply(source, vec![&earlier, &later]), apply(source, vec![&later, &earlier]));
    }

    #[test]
    fn a_fix_that_replaces_with_nothing_is_a_deletion() {
        let source = "keep DELETE keep";
        let deletion = fix(5, 12, "");

        assert_eq!(apply(source, vec![&deletion]), Some("keep keep".to_string()));
    }

    #[test]
    fn write_atomically_replaces_the_file_and_leaves_no_temp_behind() {
        let path = std::env::temp_dir().join(format!("carburetor-fix-test-{}.txt", std::process::id()));
        fs::write(&path, "old content").unwrap();

        write_atomically(&path, "new content").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");

        let mut temp_name = path.as_os_str().to_os_string();
        temp_name.push(".carburetor-fix.tmp");
        assert!(!Path::new(&temp_name).exists(), "the temporary file must not survive a successful write");

        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_failed_publish_leaves_the_original_untouched() {
        // The rename's destination is a directory, so it fails after the temp file is already
        // written — exactly the case the atomic swap exists to guard: the failure must not have
        // touched the real path.
        let path = std::env::temp_dir().join(format!("carburetor-fix-test-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir(&path).unwrap();

        let result = write_atomically(&path, "new content");

        assert!(result.is_err());
        assert!(path.is_dir(), "the original must survive a failed publish");

        fs::remove_dir_all(&path).unwrap();
    }

    #[test]
    fn diff_isolates_the_changed_lines_between_unchanged_context() {
        let old = "one\ntwo\nthree\nfour";
        let new = "one\nTWO\nTHREE\nfour";

        assert_eq!(diff(old, new), "- two\n- three\n+ TWO\n+ THREE\n");
    }

    #[test]
    fn diff_of_identical_text_is_empty() {
        assert_eq!(diff("same", "same"), "");
    }

    #[cfg(unix)]
    #[test]
    fn write_atomically_preserves_the_executable_bit() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!("carburetor-fix-test-mode-{}", std::process::id()));
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        write_atomically(&path, "new").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();

        assert_eq!(mode & 0o777, 0o755, "the executable bit must survive the atomic write");

        fs::remove_file(&path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn write_atomically_preserves_a_restricted_mode() {
        use std::os::unix::fs::PermissionsExt;

        let path =
            std::env::temp_dir().join(format!("carburetor-fix-test-mode-restricted-{}", std::process::id()));
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        write_atomically(&path, "new").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();

        assert_eq!(mode & 0o777, 0o640);

        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_failed_publish_leaves_no_temp_behind() {
        // The rename's destination is a directory, so the publish fails after the temp is written;
        // the temp must be cleaned up either way.
        let path = std::env::temp_dir().join(format!("carburetor-fix-test-dir-temp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir(&path).unwrap();

        let result = write_atomically(&path, "new");

        assert!(result.is_err());

        let mut temp_name = path.as_os_str().to_os_string();
        temp_name.push(".carburetor-fix.tmp");
        assert!(!Path::new(&temp_name).exists(), "the temporary file must be cleaned up on failure");

        fs::remove_dir_all(&path).unwrap();
    }
}
