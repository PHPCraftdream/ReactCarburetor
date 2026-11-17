//! A collection or a string assembled entirely from constants inside a function.
//!
//! A string literal costs nothing per call: the engine keeps one copy. What a function builds does
//! cost, every call: `new Set([WILDCARD])` allocates a set and its array, `PREFIX + '.'` and
//! `` `${PREFIX}.` `` allocate a new string, and none of them can differ from one call to the next.
//! Measured on V8, a per-call `new Set([x])` is about fifteen times slower than reading a hoisted
//! one, a concatenation four times, and both feed the young-generation collector. The rule reports
//! such a value inside a function when every part of it is a literal, an import, a module-level
//! `const`, or a member of one; build it once at module level instead. An empty collection is a
//! fresh mutable value by intent and is left alone, and so is a concatenation of literals only,
//! which the engine folds. A message built for `new …Error(...)` or a `throw` is on a cold path
//! and is not reported either. Code inside a test registrar's callback is out of scope.

use oxc_ast::ast::{
    ArrayExpressionElement, ArrowFunctionExpression, BinaryExpression, Expression, Function,
    NewExpression, Program, TemplateLiteral, ThrowStatement,
};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_span::GetSpan;
use oxc_syntax::operator::BinaryOperator;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::referenced_symbol;
use crate::rules::support::walk::test_scope::retain_outside_tests;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-hoisted-constant";

const COLLECTION_MESSAGE: &str = "this collection is built from constants on every call: the same \
    set or map, allocated again each time. Build it once in a module-level const and use that.";

const STRING_MESSAGE: &str = "this string is assembled from constants on every call: a new string \
    each time, always the same one. Build it once in a module-level const and use that.";

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    depth: usize,
    diagnostics: Vec<Diagnostic>,
}

/// A constant leaf: whether it is known to be a string, and whether it is a name rather than a
/// literal the engine could fold.
#[derive(Clone, Copy)]
struct Leaf {
    text: bool,
    binding: bool,
}

/// Whether an initializer is a string: a string literal, a template, or a `+` chain holding one.
fn is_text(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => true,
        Expression::BinaryExpression(binary) => {
            binary.operator == BinaryOperator::Addition
                && (is_text(&binary.left) || is_text(&binary.right))
        }
        Expression::ParenthesizedExpression(inner) => is_text(&inner.expression),
        _ => false,
    }
}

impl<'a> Check<'a, '_> {
    /// A literal, or a name bound once at module level (an import or a `const`), or a member of one.
    fn leaf(&self, expression: &Expression<'a>) -> Option<Leaf> {
        match expression {
            Expression::StringLiteral(_) => Some(Leaf {
                text: true,
                binding: false,
            }),
            Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_) => Some(Leaf {
                text: false,
                binding: false,
            }),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                Some(Leaf {
                    text: true,
                    binding: false,
                })
            }
            Expression::ParenthesizedExpression(inner) => self.leaf(&inner.expression),
            Expression::StaticMemberExpression(member) => self.leaf(&member.object).map(|_| Leaf {
                text: false,
                binding: true,
            }),
            Expression::Identifier(identifier) => {
                let symbol = referenced_symbol(identifier, self.semantic)?;
                let scoping = self.semantic.scoping();
                let flags = scoping.symbol_flags(symbol);

                if scoping.symbol_scope_id(symbol) != scoping.root_scope_id()
                    || !(flags.is_import() || flags.is_const_variable())
                {
                    return None;
                }

                let text = match self.semantic.symbol_declaration(symbol).kind() {
                    AstKind::VariableDeclarator(declarator) => {
                        declarator.init.as_ref().is_some_and(is_text)
                    }
                    _ => false,
                };

                Some(Leaf {
                    text,
                    binding: true,
                })
            }
            _ => None,
        }
    }

    /// Whether a `+` chain is a string built only from constants, with at least one name in it
    /// (literals alone are folded by the engine).
    fn constant_concat(&self, binary: &BinaryExpression<'a>) -> bool {
        let mut leaves = Vec::new();

        self.concat_leaves(binary, &mut leaves)
            && leaves.iter().any(|leaf| leaf.text)
            && leaves.iter().any(|leaf| leaf.binding)
    }

    fn concat_leaves(&self, binary: &BinaryExpression<'a>, leaves: &mut Vec<Leaf>) -> bool {
        binary.operator == BinaryOperator::Addition
            && [&binary.left, &binary.right]
                .into_iter()
                .all(|side| match side {
                    Expression::BinaryExpression(inner) => self.concat_leaves(inner, leaves),
                    other => self.leaf(other).map(|leaf| leaves.push(leaf)).is_some(),
                })
    }

    /// `new Set([A, B])` or `new Map([[A, 1]])` with only constant elements.
    fn constant_collection(&self, call: &NewExpression<'a>) -> bool {
        let Expression::Identifier(callee) = &call.callee else {
            return false;
        };

        if !matches!(callee.name.as_str(), "Set" | "Map" | "WeakSet" | "WeakMap") {
            return false;
        }

        let [argument] = call.arguments.as_slice() else {
            return false;
        };
        let Some(Expression::ArrayExpression(array)) = argument.as_expression() else {
            return false;
        };

        !array.elements.is_empty()
            && array
                .elements
                .iter()
                .all(|element| self.constant_element(element))
    }

    fn constant_element(&self, element: &ArrayExpressionElement<'a>) -> bool {
        match element.as_expression() {
            Some(Expression::ArrayExpression(pair)) => {
                !pair.elements.is_empty()
                    && pair
                        .elements
                        .iter()
                        .all(|inner| self.constant_element(inner))
            }
            Some(expression) => self.leaf(expression).is_some(),
            None => false,
        }
    }

    fn push(&mut self, start: u32, message: &str) {
        self.diagnostics
            .push(report(self.source, start, RULE, message.to_string()));
    }
}

impl<'a> Visit<'a> for Check<'a, '_> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        self.depth += 1;
        walk::walk_function(self, function, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.depth += 1;
        walk::walk_arrow_function_expression(self, arrow);
        self.depth -= 1;
    }

    fn visit_new_expression(&mut self, call: &NewExpression<'a>) {
        // An error's message is built once, on the way out: a cold path, not worth a constant.
        if matches!(&call.callee, Expression::Identifier(callee) if callee.name.ends_with("Error"))
        {
            return;
        }

        if self.depth > 0 && self.constant_collection(call) {
            self.push(call.span.start, COLLECTION_MESSAGE);

            return;
        }

        walk::walk_new_expression(self, call);
    }

    fn visit_throw_statement(&mut self, _statement: &ThrowStatement<'a>) {}

    fn visit_binary_expression(&mut self, binary: &BinaryExpression<'a>) {
        if self.depth > 0 && self.constant_concat(binary) {
            self.push(binary.span.start, STRING_MESSAGE);

            return;
        }

        walk::walk_binary_expression(self, binary);
    }

    fn visit_template_literal(&mut self, template: &TemplateLiteral<'a>) {
        if self.depth > 0
            && !template.expressions.is_empty()
            && template
                .expressions
                .iter()
                .all(|expression| self.leaf(expression).is_some())
        {
            self.push(template.span().start, STRING_MESSAGE);

            return;
        }

        walk::walk_template_literal(self, template);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source<'_>,
    semantic: &Semantic<'a>,
) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        semantic,
        depth: 0,
        diagnostics: Vec::new(),
    };

    check.visit_program(program);

    let mut diagnostics = check.diagnostics;
    retain_outside_tests(&mut diagnostics, RULE, program, semantic, source);

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn collections_built_from_constants_inside_a_function_are_reported() {
        let source = concat!(
            "import {WILDCARD} from './paths';\n",
            "const ALL = 'all';\n",
            "function watch(store) {\n",
            "    store.subscribe(run, {reads: new Set([WILDCARD])});\n",
            "    const kinds = new Map([[ALL, 1], ['x', 2]]);\n",
            "    return new Set(['a', Status.Idle]);\n",
            "}\n",
            "import {Status} from './status';\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [4, 5, 6]);
    }

    #[test]
    fn strings_assembled_from_constants_inside_a_function_are_reported() {
        let source = concat!(
            "import {SEPARATOR} from './paths';\n",
            "const ROOT = 'entries';\n",
            "const read = (path) => path.startsWith(ROOT + SEPARATOR);\n",
            "const key = () => `${ROOT}${SEPARATOR}x`;\n",
            "const label = () => 'a' + ROOT + 'b';\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [3, 4, 5]);
    }

    #[test]
    fn module_level_values_dynamic_parts_and_empty_collections_are_fine() {
        let source = concat!(
            "import {SEPARATOR} from './paths';\n",
            "const EVERY = new Set(['*']);\n",
            "const PREFIX = 'entries' + SEPARATOR;\n",
            "function make(name, list) {\n",
            "    let local = 'x';\n",
            "    const fresh = new Set();\n",
            "    const own = new Set([name]);\n",
            "    const copy = new Set(list);\n",
            "    const action = name + '/update';\n",
            "    const folded = 'a' + 'b';\n",
            "    const text = `${name}.${SEPARATOR}`;\n",
            "    if (!name) throw new Error('missing ' + SEPARATOR + ' name');\n",
            "    if (!list) throw `no list at ${SEPARATOR}`;\n",
            "    return [fresh, own, copy, action, folded, text, local + SEPARATOR];\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn code_inside_a_test_callback_is_out_of_scope() {
        let source = concat!(
            "const ALL = 'all';\n",
            "test('x', () => {\n",
            "    expect(new Set([ALL])).toBeDefined();\n",
            "});\n",
        );

        assert!(diagnose(source, check).is_empty());
    }
}
