use super::*;

fn at(node: &Node) -> &AtRule {
    match node {
        Node::At(rule) => rule,
        other => panic!("expected an at-rule, got {other:?}"),
    }
}

fn rule(node: &Node) -> &StyleRule {
    match node {
        Node::Rule(rule) => rule,
        other => panic!("expected a style rule, got {other:?}"),
    }
}

fn declaration(node: &Node) -> &Declaration {
    match node {
        Node::Declaration(declaration) => declaration,
        other => panic!("expected a declaration, got {other:?}"),
    }
}

#[test]
fn theme_block_with_reset_and_roles() {
    let text =
        "@theme {\n  --color-*: initial;\n  --color-accent-fill: var(--palette-blue-600);\n}\n";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    assert_eq!(sheet.nodes.len(), 1);
    let theme = at(&sheet.nodes[0]);
    assert_eq!(theme.name.text(text), "theme");
    assert_eq!(theme.at, 0);
    assert_eq!(theme.prelude.text(text), "");
    let block = theme.block.as_ref().unwrap();
    assert_eq!(block.len(), 2);
    assert_eq!(declaration(&block[0]).name.text(text), "--color-*");
    assert_eq!(declaration(&block[0]).value.text(text), "initial");
    assert_eq!(
        declaration(&block[1]).value.text(text),
        "var(--palette-blue-600)"
    );
}

#[test]
fn utility_with_apply_and_variants() {
    let text = "@utility tone-accent-solid {\n  @apply bg-accent-fill hover:bg-accent-fill-hover data-[a:b]:text-accent-on-fill;\n}";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    let utility = at(&sheet.nodes[0]);
    assert_eq!(utility.name.text(text), "utility");
    assert_eq!(utility.prelude.text(text), "tone-accent-solid");
    let block = utility.block.as_ref().unwrap();
    let apply = at(&block[0]);
    assert_eq!(apply.name.text(text), "apply");
    assert_eq!(
        apply.prelude.text(text),
        "bg-accent-fill hover:bg-accent-fill-hover data-[a:b]:text-accent-on-fill"
    );
    assert!(apply.block.is_none());
}

#[test]
fn components_layer_with_plain_and_nested_state_rules() {
    let text = r#"@layer components {
  .order-status { @apply pattern-badge tone-neutral-soft; }
  .order-status[data-status="paid"] { @apply tone-success-soft; }
  .user-card {
    @apply pattern-card tone-surface-raised;
    &[aria-current="true"] { @apply tone-accent-soft; }
  }
}"#;
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    let layer = at(&sheet.nodes[0]);
    assert_eq!(layer.prelude.text(text), "components");
    let rules = layer.block.as_ref().unwrap();
    assert_eq!(rules.len(), 3);
    assert_eq!(rule(&rules[0]).selector.text(text), ".order-status");
    assert_eq!(
        rule(&rules[1]).selector.text(text),
        r#".order-status[data-status="paid"]"#
    );
    let card = rule(&rules[2]);
    assert_eq!(card.body.len(), 2);
    assert_eq!(
        rule(&card.body[1]).selector.text(text),
        r#"&[aria-current="true"]"#
    );
}

#[test]
fn comments_and_strings_never_open_or_close_blocks() {
    let text = "/* { not a block } */\n.a[title=\"}\"] { content: '{;}'; /* } */ color: red }\n";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    assert_eq!(sheet.nodes.len(), 1);
    let only = rule(&sheet.nodes[0]);
    assert_eq!(only.selector.text(text), ".a[title=\"}\"]");
    assert_eq!(only.body.len(), 2);
    assert_eq!(declaration(&only.body[0]).value.text(text), "'{;}'");
    assert_eq!(declaration(&only.body[1]).name.text(text), "color");
    assert_eq!(declaration(&only.body[1]).value.text(text), "red");
    assert_eq!(sheet.comments.len(), 2);
    assert_eq!(sheet.comments[0].content.text(text), " { not a block } ");
    assert_eq!(sheet.comments[0].end, 21);
}

#[test]
fn statement_at_rules_without_blocks_are_kept() {
    let text = "@import \"tailwindcss\";\n@source \"../src\";\n@custom-variant dark (&:where(.dark, .dark *));";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    let names: Vec<&str> = sheet
        .nodes
        .iter()
        .map(|node| at(node).name.text(text))
        .collect();
    assert_eq!(names, ["import", "source", "custom-variant"]);
    assert_eq!(at(&sheet.nodes[0]).prelude.text(text), "\"tailwindcss\"");
}

#[test]
fn a_missing_semicolon_before_the_closing_brace_is_still_a_declaration() {
    let text = ":root { --palette-white: #fff }";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    let root = rule(&sheet.nodes[0]);
    assert_eq!(
        declaration(&root.body[0]).name.text(text),
        "--palette-white"
    );
    assert_eq!(declaration(&root.body[0]).value.text(text), "#fff");
}

#[test]
fn an_unclosed_block_is_reported_at_its_opening() {
    let text = ".a {\n  color: red;\n.b { color: blue; }";
    let sheet = parse(text);

    assert_eq!(
        sheet.errors,
        vec![ParseError {
            offset: 0,
            message: "this block is never closed"
        }]
    );
    let outer = rule(&sheet.nodes[0]);
    assert_eq!(outer.body.len(), 2);
}

#[test]
fn a_stray_closing_brace_is_reported_and_skipped() {
    let text = "}\n.a { color: red; }";
    let sheet = parse(text);

    assert_eq!(
        sheet.errors,
        vec![ParseError {
            offset: 0,
            message: "this `}` closes no block"
        }]
    );
    assert_eq!(sheet.nodes.len(), 1);
}

#[test]
fn text_that_is_neither_declaration_nor_block_is_reported() {
    let text = ".a { nonsense; color: red; }";
    let sheet = parse(text);

    assert_eq!(
        sheet.errors,
        vec![ParseError {
            offset: 5,
            message: "expected `property: value` or a block"
        }]
    );
    assert_eq!(rule(&sheet.nodes[0]).body.len(), 1);
}

#[test]
fn an_unclosed_comment_is_reported() {
    let text = ".a { color: red; }\n/* never closed";
    let sheet = parse(text);

    assert_eq!(
        sheet.errors,
        vec![ParseError {
            offset: 19,
            message: "this comment is never closed"
        }]
    );
    assert_eq!(sheet.comments.len(), 1);
}

#[test]
fn crlf_line_endings_and_multibyte_text_keep_byte_offsets() {
    let text = "/* é */\r\n.a {\r\n  content: \"ü\";\r\n}\r\n.b { color: red; }";
    let sheet = parse(text);

    assert!(sheet.errors.is_empty(), "{:?}", sheet.errors);
    assert_eq!(sheet.nodes.len(), 2);
    assert_eq!(rule(&sheet.nodes[1]).selector.text(text), ".b");
    assert_eq!(
        declaration(&rule(&sheet.nodes[0]).body[0]).value.text(text),
        "\"ü\""
    );
}

#[test]
fn hostile_nesting_is_bounded() {
    let text = format!("{}{}", ".a {".repeat(200), "}".repeat(200));
    let sheet = parse(&text);

    assert_eq!(sheet.errors.len(), 1);
    assert_eq!(
        sheet.errors[0].message,
        "this block is nested too deeply to check"
    );
}

#[test]
fn an_unbalanced_parenthesis_does_not_swallow_the_file() {
    let text = ".a { width: calc(1px; }\n.b { color: red; }";
    let sheet = parse(text);

    assert_eq!(sheet.nodes.len(), 2);
    assert_eq!(rule(&sheet.nodes[1]).selector.text(text), ".b");
}
