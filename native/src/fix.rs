//! One rule's suggested edit, and the two things every consumer of one needs: resolving overlaps
//! between several edits in the same file, and writing the result without ever leaving a
//! half-written file behind if the process dies mid-write.

use std::fs;
use std::io;
use std::path::Path;

use serde::Serialize;

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
/// platform this runs on — ever touches `path` itself.
pub fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    let mut temp_name = path.as_os_str().to_os_string();
    temp_name.push(".carburetor-fix.tmp");
    let temp_path = Path::new(&temp_name).to_path_buf();

    fs::write(&temp_path, text)?;
    fs::rename(&temp_path, path)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fix(start: u32, end: u32, text: &str) -> Fix {
        Fix { start, end, text: text.to_string() }
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
}
