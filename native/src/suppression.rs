//! Suppression directives — comments that name the rules they silence, for one line or for the
//! whole file.
//!
//! Two scopes, four keywords. `carburetor-disable-next-line` and the oxlint spelling
//! `oxlint-disable-next-line` silence their rules on the line directly below the comment and
//! nothing else; `carburetor-disable` and the oxlint spelling `oxlint-disable` silence them on
//! every line of the file. The oxlint spellings exist because this repository's own sources
//! already carry them, and a file should not need two comments to silence one rule in two
//! linters.
//!
//! A directive must be the whole comment: trimmed content starts with a keyword, and everything
//! after it is only the rule list (whitespace and commas). Prose that merely mentions a
//! directive ("see carburetor-disable in the docs") silences nothing. For the next-line scope a
//! trailing comment after code counts (`let x = 1; // carburetor-disable-next-line foo`); for
//! the whole-file scope, the comment consisting only of the directive is what makes it a
//! comment of its own — a whole-file directive riding along on a comment that says something
//! else would silence files nobody meant to silence.
//!
//! Rule lists follow the config.rs convention: names may be bare or carry the "carburetor/"
//! prefix and are normalised to bare for matching; a directive with no list silences every
//! carburetor rule; names that match no known rule are accepted and simply never match a
//! diagnostic.

use std::collections::BTreeMap;

use oxc_ast::ast::Program;

use crate::rules::locate;

/// The "carburetor/" prefix rule ids wear in comments, config files and diagnostics. Directives
/// are stored and matched by bare name: the prefix is presentation, the bare name is identity.
const PREFIX: &str = "carburetor/";

/// Which lines a directive covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    /// The line directly below the comment.
    NextLine,
    /// Every line of the file.
    WholeFile,
}

/// The set of rules a directive names: every carburetor rule, or the listed ones, stored bare.
///
/// The default set — what a file with no directives, or a scope nothing has merged into, holds —
/// covers NOTHING: "every rule" is an explicit `every: true`, never an absent set. This is
/// deliberate, because `Suppression` starts at `Default` and a file that never mentions a
/// directive must silence nothing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct RuleSet {
    /// The directive named no rules, silencing every carburetor rule.
    every: bool,
    /// The bare names the directive listed explicitly.
    names: Vec<String>,
}

impl RuleSet {
    /// Union of two rule sets: an "every rule" directive swallows everything, because one such
    /// directive is enough to cover the scope, and two lists union, because two directives can
    /// share a scope and losing one to an overwrite would silently un-silence a rule. A default
    /// set is the identity — it adds nothing and is swallowed by anything.
    fn merge(&mut self, other: RuleSet) {
        self.every = self.every || other.every;
        self.names.extend(other.names);
    }

    /// Whether the set covers a bare rule name: `every` covers all; otherwise only a listed name
    /// matches, so a default set — and any set without `every` and without names — covers
    /// nothing.
    fn covers(&self, name: &str) -> bool {
        self.every || self.names.iter().any(|listed| listed == name)
    }
}

/// Directive keywords, longest first. Order is load-bearing: `carburetor-disable-next-line`
/// STARTS WITH `carburetor-disable`, so a naive prefix check reads every next-line directive as
/// whole-file and silently silences everything below it. The boundary check in
/// `parse_directive` is the second half of the defence — it keeps a near-miss like
/// `carburetor-disabled` from matching the shorter keyword.
const KEYWORDS: [(&str, Scope); 4] = [
    ("carburetor-disable-next-line", Scope::NextLine),
    ("oxlint-disable-next-line", Scope::NextLine),
    ("carburetor-disable", Scope::WholeFile),
    ("oxlint-disable", Scope::WholeFile),
];

/// What one comment directs, once parsed out of its content.
struct Parsed {
    scope: Scope,
    rules: RuleSet,
}

/// The suppression directives one file carries: which rules are silenced where.
#[derive(Debug, Default)]
pub struct Suppression {
    /// Rule set silenced on every line, from whole-file directives. The default covers nothing.
    whole_file: RuleSet,
    /// Line -> rule set silenced on exactly that line, from next-line directives. Entries are
    /// created empty and cover nothing until a directive merges into them.
    lines: BTreeMap<usize, RuleSet>,
}

impl Suppression {
    /// Collects suppression directives from one parsed file's comments.
    pub fn build(program: &Program<'_>) -> Suppression {
        let mut suppression = Suppression::default();

        for comment in &program.comments {
            let Some(parsed) = parse_directive(&program.source_text[comment.content_span()])
            else {
                continue;
            };

            // The line a directive takes effect from. A line comment and a single-line block sit
            // on one line, so their end is on their own line; a MULTI-line block ends at its
            // closing `*/`, so a next-line directive under it silences the first line after the
            // comment ends, not the line below where it opened.
            let (line, _) = locate(program.source_text, comment.span.end);

            match parsed.scope {
                Scope::NextLine => {
                    suppression.lines.entry(line + 1).or_default().merge(parsed.rules);
                }
                Scope::WholeFile => {
                    suppression.whole_file.merge(parsed.rules);
                }
            }
        }

        suppression
    }

    /// Whether `rule` (id with or without the "carburetor/" prefix) is silenced on `line`
    /// (1-based, as produced by `crate::rules::locate`).
    pub fn silenced(&self, rule: &str, line: usize) -> bool {
        let name = bare_name(rule);

        // Whole-file scope first: one `carburetor-disable` covers every line, wherever it sits.
        if self.whole_file.covers(name) {
            return true;
        }

        self.lines.get(&line).is_some_and(|rules| rules.covers(name))
    }
}

/// The rule id a directive or query names, with the presentation prefix stripped.
fn bare_name(rule: &str) -> &str {
    rule.strip_prefix(PREFIX).unwrap_or(rule)
}

/// The directive a comment carries, if any. The trimmed content must start with a keyword
/// followed by end-of-content or the start of a rule list (whitespace/comma) — prose that
/// merely mentions a directive is not one, and silences nothing.
fn parse_directive(content: &str) -> Option<Parsed> {
    let content = content.trim();

    for (keyword, scope) in KEYWORDS {
        let Some(rest) = content.strip_prefix(keyword) else {
            continue;
        };

        if !rest.is_empty() && !rest.starts_with(|c: char| c.is_whitespace() || c == ',') {
            continue;
        }

        return Some(Parsed { scope, rules: parse_rules(rest) });
    }

    None
}

/// The rule list after a keyword: whitespace- and/or comma-separated names, bare or prefixed,
/// normalised to bare. Unknown names are kept — they simply never match a diagnostic. No names
/// at all means the directive silences every carburetor rule; the empty `RuleSet` a default
/// would give covers nothing.
fn parse_rules(rest: &str) -> RuleSet {
    let names: Vec<String> = rest
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|name| !name.is_empty())
        .map(|name| bare_name(name).to_string())
        .collect();

    let every = names.is_empty();
    RuleSet { every, names }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    const RULE: &str = "carburetor/no-lifecycle-class-property";

    /// Parses `text` and collects its directives — the same path `check_file` takes.
    fn build_from(text: &str) -> Suppression {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::mjs()).parse();

        assert!(parsed.diagnostics.is_empty(), "test source must parse");

        Suppression::build(&parsed.program)
    }

    #[test]
    fn next_line_directive_silences_exactly_the_line_below() {
        let suppression = build_from(
            "const a = 1;\n\
             // carburetor-disable-next-line carburetor/no-lifecycle-class-property\n\
             const offending = 1;\n\
             const b = 2;\n",
        );

        assert!(!suppression.silenced(RULE, 1));
        assert!(!suppression.silenced(RULE, 2));
        assert!(suppression.silenced(RULE, 3));
        assert!(!suppression.silenced(RULE, 4));
    }

    #[test]
    fn the_oxlint_next_line_spelling_behaves_identically() {
        let suppression = build_from(
            "// oxlint-disable-next-line no-lifecycle-class-property\n\
             const offending = 1;\n\
             const b = 2;\n",
        );

        // Queried with the prefixed id although the directive names the bare form.
        assert!(suppression.silenced(RULE, 2));
        assert!(!suppression.silenced(RULE, 3));
    }

    #[test]
    fn a_next_line_directive_must_sit_directly_above() {
        let suppression = build_from(
            "// carburetor-disable-next-line no-lifecycle-class-property\n\
             const not_covered = 1;\n\
             const offending = 1;\n",
        );

        assert!(suppression.silenced(RULE, 2));
        assert!(!suppression.silenced(RULE, 3));
    }

    #[test]
    fn a_whole_file_directive_silences_every_line() {
        let suppression = build_from(
            "const first = 1;\n\
             // carburetor-disable carburetor/no-lifecycle-class-property\n\
             const last = 2;\n",
        );

        assert!(suppression.silenced(RULE, 1));
        assert!(suppression.silenced(RULE, 3));
    }

    #[test]
    fn prose_mentioning_a_directive_silences_nothing() {
        let suppression = build_from(
            "// see carburetor-disable in the docs before using it\n\
             const offending = 1;\n\
             // the carburetor-disable-next-line form works line by line\n\
             const also_offending = 1;\n",
        );

        assert!(!suppression.silenced(RULE, 2));
        assert!(!suppression.silenced(RULE, 4));
    }

    #[test]
    fn comma_and_space_lists_match_bare_and_prefixed_names() {
        let suppression = build_from(
            "// carburetor-disable-next-line no-lifecycle-class-property, \
             carburetor/require-effect-deps\n\
             const offending = 1;\n",
        );

        // Queried the other way round from how each name is written.
        assert!(suppression.silenced(RULE, 2));
        assert!(suppression.silenced("carburetor/require-effect-deps", 2));
        assert!(!suppression.silenced("carburetor/require-subscription-disposal", 2));

        let suppression = build_from(
            "// carburetor-disable require-effect-deps carburetor/require-subscription-disposal\n\
             const offending = 1;\n",
        );

        assert!(suppression.silenced("carburetor/require-subscription-disposal", 1));
        assert!(!suppression.silenced(RULE, 1));
    }

    #[test]
    fn a_next_line_directive_does_not_silence_the_whole_file() {
        // "carburetor-disable-next-line" starts with "carburetor-disable": a prefix check would
        // classify this as file-wide and silence every line below the comment.
        let suppression = build_from(
            "// carburetor-disable-next-line no-lifecycle-class-property\n\
             const offending = 1;\n\
             const also_offending = 1;\n\
             const still_offending = 1;\n",
        );

        assert!(suppression.silenced(RULE, 2));
        assert!(!suppression.silenced(RULE, 3));
        assert!(!suppression.silenced(RULE, 4));
    }

    #[test]
    fn a_single_line_block_comment_directive_works_like_the_line_form() {
        let suppression = build_from(
            "/* carburetor-disable-next-line no-lifecycle-class-property */\n\
             const offending = 1;\n\
             const b = 2;\n",
        );

        assert!(suppression.silenced(RULE, 2));
        assert!(!suppression.silenced(RULE, 3));
    }

    #[test]
    fn a_multi_line_block_directive_starts_after_the_comment_ends() {
        let suppression = build_from(
            "/* carburetor-disable-next-line no-lifecycle-class-property\n\
               still inside the comment */\n\
             const offending = 1;\n\
             const b = 2;\n",
        );

        // The silenced line is the first one BELOW the closing `*/`, not the line below where
        // the block opened.
        assert!(!suppression.silenced(RULE, 2));
        assert!(suppression.silenced(RULE, 3));
        assert!(!suppression.silenced(RULE, 4));
    }

    #[test]
    fn a_directive_without_a_rule_list_silences_every_rule() {
        let suppression =
            build_from("// carburetor-disable-next-line\nconst offending = 1;\nconst b = 2;\n");

        assert!(suppression.silenced(RULE, 2));
        assert!(suppression.silenced("carburetor/require-effect-deps", 2));
        assert!(!suppression.silenced("carburetor/require-effect-deps", 3));
    }

    #[test]
    fn a_file_without_comments_silences_nothing() {
        let suppression = build_from("const a = 1;\nconst b = 2;\n");

        assert!(!suppression.silenced(RULE, 1));
        assert!(!suppression.silenced(RULE, 2));
    }
}
