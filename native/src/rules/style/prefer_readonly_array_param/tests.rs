use super::*;
use crate::rules::support::testing::{diagnose, lines};

#[test]
fn destructuring_member_targets_suppress_but_reads_do_not() {
    for body in [
        "[p[0]]=[1]",
        "({a:p.length}=o)",
        "([...p[0]]=[])",
        "for(p[0] of xs){}",
        "for(p[i] in o){}",
        "[p[0]=1]=[]",
        "({a:[...p[0]]}=o)",
        "({a:p[0]=1}=o)",
        "({...p[0]}=o)",
        "[...p[0]]=[]",
        "([{a:[p[0]]}]=xs)",
        "p[0]++",
        "--p[0]",
        "p.length=0",
        "[p]=xs",
        "({a:p}=o)",
    ] {
        assert!(
            diagnose(&format!("function f(p:any[],i:number){{{body};}}"), check).is_empty(),
            "{body}"
        );
    }
    let safe = diagnose(
        concat!(
            "function f(p:any[],other:number[],i:number){",
            "[other[0]]=[p.length]; [other[0]=p.length]=[];",
            "({[p.length]:other[0]}=o); other[p.length]=1;",
            "for(other[0] of p){} for(other[0] in o){}; }"
        ),
        check,
    );
    assert_eq!(lines(&safe), [1]);
}

#[test]
fn conservative_use_whitelist_and_safe_reads() {
    let safe = diagnose(
        r#"
function length(x: string[]) { return x.length; }
function index(x: string[], i: number) { return x[i]; }
function iterate(x: string[]) { for (const value of x) void value; }
function spread(x: string[]) { const copy = [...x]; consume(...x); }
function compare(x: string[], y: readonly string[]) { return x === y && typeof x === 'object' && 'length' in x; }
function objectSpread(x: string[]) { const copy = {...x}; }
function method(x: string[]) { return x.map(v => v.length); }
function condition(x: string[]) { return x ? typeof x === 'object' && 'length' in x && x === x : false; }
function standalone(x: string[]) { void typeof x; void !x; }
function loop(x: string[]) { for (; x; ) { break; } }
function concat(x: string[]) { return x.concat(...x); }
function unrelated(x: string[]) { other = value; count++; delete other[0]; }
"#,
        check,
    );
    assert_eq!(lines(&safe), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for body in [
        "[x]",
        "({a:x})",
        "obj.value=x",
        "consume(x)",
        "return x",
        "`${x}`",
        "[x]=other",
        "({x}=other)",
        "for ([x] of others) {}",
        "for ({x} of others) {}",
        "x === consume(x)",
        "x === (x.push('a'), x)",
        "const aliases=[x]; aliases[0].push('a')",
        "const y=x; y.push('a')",
        "const f=()=>{ return x; }",
    ] {
        assert!(
            diagnose(&format!("function f(x:string[]){{{body};}}"), check).is_empty(),
            "{body}"
        );
    }
}

#[test]
fn fixes_apply_to_source() {
    let source = "function f(x: string[]) { void x.length; }";
    let diagnostics = diagnose(source, check);
    let fixed = crate::fix::apply(
        source,
        diagnostics.iter().filter_map(|d| d.fix.as_ref()).collect(),
    );
    assert_eq!(
        fixed.as_deref(),
        Some("function f(x: readonly string[]) { void x.length; }")
    );
}

#[test]
fn declaration_file_path_excludes_implementation_body() {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;
    let text = "function f(x: string[]) { void x.length; }";
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        text,
        SourceType::default()
            .with_module(true)
            .with_typescript(true),
    )
    .parse();
    assert!(parsed.diagnostics.is_empty());
    let ts = Source::new(Path::new("fixture.ts"), text);
    let dts = Source::new(Path::new("fixture.d.ts"), text);
    let bases = crate::rules::support::bases::Bases::default();
    assert_eq!(check(&parsed.program, &ts, &bases).len(), 1);
    assert!(check(&parsed.program, &dts, &bases).is_empty());
}

#[test]
fn fixes_and_reports_supported_forms() {
    let d = diagnose(
        r#"
function decl(x: (A | B)[]) {}
const expression = function (x?: string[]) {};
class C {
    method(x: Array<number> = []) {}
    optional(x?: number[]) {}
}
const block = (x: string[]) => { void x.length; };
const concise = (x: number[]) => [...x];
"#,
        check,
    );
    assert_eq!(lines(&d), [2, 3, 5, 6, 8, 9]);
    assert_eq!(
        d[0].message,
        concat!(
            "Parameter 'x' is never mutated; accept `readonly (A | B)[]` ",
            "so read-only store data can be passed without a copy."
        )
    );
    assert_eq!(d[0].fix.as_ref().unwrap().text, "readonly (A | B)[]");
    assert_eq!(d[1].fix.as_ref().unwrap().text, "readonly string[]");
    assert_eq!(d[2].fix.as_ref().unwrap().text, "ReadonlyArray<number>");
}

#[test]
fn skips_readonly_and_destructured_parameters() {
    let d = diagnose(
        r#"
function a(x: readonly string[]) {}
function b(x: ReadonlyArray<number>) {}
function c(...x: string[]) {}
function d([x]: string[][]) {}
function e({x}: {x: string[]}) {}
"#,
        check,
    );
    assert!(d.is_empty());
}

#[test]
fn constructors_and_overloads_respect_implementation_status() {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    let d = diagnose(
        r#"
class A { constructor(xs: string[]) {} }
class B { constructor(private xs: string[]) {} }
class C { constructor(public xs: string[]) {} }
class D { constructor(protected xs: string[]) {} }
class E { constructor(readonly xs: string[]) {} }
function overloaded(x: string[]): void;
function overloaded(x: string[]): void { void x.length; }
"#,
        check,
    );
    assert_eq!(lines(&d), [2, 8]);

    let fix = d[0].fix.as_ref().unwrap();
    let text = r#"
class A { constructor(xs: string[]) {} }
class B { constructor(private xs: string[]) {} }
class C { constructor(public xs: string[]) {} }
class D { constructor(protected xs: string[]) {} }
class E { constructor(readonly xs: string[]) {} }
function overloaded(x: string[]): void;
function overloaded(x: string[]): void { void x.length; }
"#;
    let mut fixed = text.to_owned();
    fixed.replace_range(fix.start as usize..fix.end as usize, &fix.text);
    let fixed_allocator = Allocator::default();
    let reparsed = Parser::new(
        &fixed_allocator,
        &fixed,
        SourceType::default()
            .with_module(true)
            .with_typescript(true),
    )
    .parse();
    assert!(reparsed.diagnostics.is_empty());
    assert_eq!(
        lines(&check(
            &reparsed.program,
            &Source::new(Path::new("fixture.ts"), &fixed),
            &crate::rules::support::bases::Bases::default()
        )),
        [8]
    );
}

#[test]
fn declarations_and_abstract_methods_are_skipped() {
    let d = diagnose(
        r#"
declare function declared(x: string[]): void;
abstract class C { abstract method(x: string[]): void; }
"#,
        check,
    );
    assert!(d.is_empty());
}

#[test]
fn mutation_escape_and_alias_cases_suppress() {
    for body in [
        "x.push(1)",
        "x['push'](1)",
        "x.pop()",
        "x.shift()",
        "x.unshift(1)",
        "x.splice(0)",
        "x.sort()",
        "x.reverse()",
        "x.fill(0)",
        "x.copyWithin(0,1)",
        "x[0]=1",
        "x[0]+=1",
        "x[0]++",
        "--x[0]",
        "x.length=0",
        "x.length+=1",
        "x.length++",
        "delete x[0]",
        "delete (x[0])",
        "x=[]",
        "consume(x)",
        "new Box(x)",
        "return x",
        "const y=x",
        "y=x",
        "obj.x=x",
        "({x})",
        "({value:x})",
        "const f=()=>x",
        "const f=()=>{ x.push(1); }",
        "x === consume(x)",
        "x === (x.push(1), x)",
        "const aliases=[x]; aliases[0].push(1)",
    ] {
        assert!(
            diagnose(&format!("function f(x:number[]){{{body};}}"), check).is_empty(),
            "{body}"
        );
    }
}

#[test]
fn concise_arrow_return_is_suppressed() {
    let d = diagnose("const f = (x: number[]) => x", check);
    assert!(d.is_empty());
}

#[test]
fn spreads_and_unrelated_delete_remain_reportable() {
    let d = diagnose(
        r#"
function objectSpread(x: string[]) { const y = {...x}; }
function arraySpread(x: number[]) { const y = [...x]; }
function unrelatedDelete(x: string[]) { delete other[0]; }
"#,
        check,
    );
    assert_eq!(lines(&d), [2, 3, 4]);
}

#[test]
fn diagnostics_use_declared_element_text_and_union_fix() {
    let d = diagnose(
        "function union(x: (A | B)[]) {}\nfunction array(x: Array<string>) {}",
        check,
    );
    assert_eq!(d[0].fix.as_ref().unwrap().text, "readonly (A | B)[]");
    assert_eq!(d[1].fix.as_ref().unwrap().text, "ReadonlyArray<string>");
    assert!(d[0].message.contains("readonly (A | B)[]"));
}

#[test]
fn declaration_file_path_skips_function_and_arrow_implementations() {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    let text = "function f(x: string[]) { void x.length; }\nconst g = (x: string[]) => x.length;";
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        text,
        SourceType::default()
            .with_module(true)
            .with_typescript(true),
    )
    .parse();
    assert!(parsed.diagnostics.is_empty());
    let bases = crate::rules::support::bases::Bases::default();
    assert_eq!(
        lines(&check(
            &parsed.program,
            &Source::new(Path::new("fixture.ts"), text),
            &bases
        )),
        [1, 2]
    );
    assert!(check(
        &parsed.program,
        &Source::new(Path::new("fixture.d.ts"), text),
        &bases
    )
    .is_empty());
}
