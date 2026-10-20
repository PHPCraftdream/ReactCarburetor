//! Suggest readonly array parameters when every use is a safe read.
use crate::fix::Fix;
use crate::rules::{report_with_fix, support::bases::Bases};
use crate::{Diagnostic, Source};
use oxc_ast::ast::{
    ArrowFunctionBody, AssignmentTarget, BindingIdentifier, BindingPattern, Expression, Function,
    Program, TSType,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
pub const RULE: &str = "carburetor/prefer-readonly-array-param";
fn is_id(e: &Expression<'_>, n: &str) -> bool {
    matches!(e.get_inner_expression(), Expression::Identifier(i) if i.name == n)
}
fn is_array_name(name: &oxc_ast::ast::TSTypeName<'_>) -> bool {
    matches!(name, oxc_ast::ast::TSTypeName::IdentifierReference(id) if id.name == "Array")
}
fn array_type(t: &TSType<'_>, s: &str) -> Option<(u32, u32, String)> {
    match t {
        TSType::TSArrayType(a) => Some((
            a.span.start,
            a.span.end,
            format!(
                "readonly {}",
                &s[a.span.start as usize..a.span.end as usize]
            ),
        )),
        TSType::TSTypeReference(r) if is_array_name(&r.type_name) => {
            let args = r.type_arguments.as_ref()?;
            if args.params.len() != 1 {
                return None;
            }
            let a = &args.params[0];
            Some((
                r.span.start,
                r.span.end,
                format!(
                    "ReadonlyArray<{}>",
                    &s[a.span().start as usize..a.span().end as usize]
                ),
            ))
        }
        _ => None,
    }
}
fn parameter_identifier<'r, 'a>(p: &'r BindingPattern<'a>) -> Option<&'r BindingIdentifier<'a>> {
    match p {
        BindingPattern::BindingIdentifier(i) => Some(i),
        BindingPattern::AssignmentPattern(a) => parameter_identifier(&a.left),
        _ => None,
    }
}
struct Scan<'a> {
    name: &'a str,
    bad: bool,
    writing_target: bool,
}
impl<'a> Visit<'a> for Scan<'_> {
    fn visit_assignment_target(&mut self, n: &AssignmentTarget<'a>) {
        if crate::rules::support::chain::assignment_root(n).identifier() == Some(self.name) {
            self.bad = true;
        }
        let was_writing = self.writing_target;
        self.writing_target = true;
        walk::walk_assignment_target(self, n);
        self.writing_target = was_writing;
    }
    fn visit_simple_assignment_target(&mut self, n: &oxc_ast::ast::SimpleAssignmentTarget<'a>) {
        if crate::rules::support::chain::simple_target_root(n).identifier() == Some(self.name) {
            self.bad = true;
        }
        let was_writing = self.writing_target;
        self.writing_target = true;
        walk::walk_simple_assignment_target(self, n);
        self.writing_target = was_writing;
    }
    fn visit_identifier_reference(&mut self, n: &oxc_ast::ast::IdentifierReference<'a>) {
        if n.name == self.name {
            self.bad = true;
        }
    }
    fn visit_expression(&mut self, n: &Expression<'a>) {
        let was_writing = self.writing_target;
        self.writing_target = false;
        walk::walk_expression(self, n);
        self.writing_target = was_writing;
    }
    fn visit_static_member_expression(&mut self, n: &oxc_ast::ast::StaticMemberExpression<'a>) {
        if self.writing_target
            && crate::rules::support::chain::chain_root(&n.object).identifier() == Some(self.name)
        {
            self.bad = true;
        }
        if !is_id(&n.object, self.name) {
            walk::walk_static_member_expression(self, n);
        }
    }
    fn visit_computed_member_expression(&mut self, n: &oxc_ast::ast::ComputedMemberExpression<'a>) {
        if self.writing_target
            && crate::rules::support::chain::chain_root(&n.object).identifier() == Some(self.name)
        {
            self.bad = true;
        }
        if is_id(&n.object, self.name) {
            self.visit_expression(&n.expression);
        } else {
            walk::walk_computed_member_expression(self, n);
        }
    }
    fn visit_call_expression(&mut self, n: &oxc_ast::ast::CallExpression<'a>) {
        let member = match n.callee.get_inner_expression() {
            Expression::StaticMemberExpression(m) if is_id(&m.object, self.name) => {
                Some((m.property.name.as_str(), true))
            }
            Expression::ComputedMemberExpression(m) if is_id(&m.object, self.name) => {
                let name = match m.expression.get_inner_expression() {
                    Expression::StringLiteral(s) => Some(s.value.as_str()),
                    _ => None,
                };
                Some((name.unwrap_or(""), name.is_some()))
            }
            _ => None,
        };
        if let Some((name, known)) = member {
            if !known
                || [
                    "push",
                    "pop",
                    "shift",
                    "unshift",
                    "splice",
                    "sort",
                    "reverse",
                    "fill",
                    "copyWithin",
                ]
                .contains(&name)
            {
                self.bad = true;
            }
            if let Expression::ComputedMemberExpression(m) = n.callee.get_inner_expression() {
                self.visit_expression(&m.expression);
            }
            for a in &n.arguments {
                self.visit_argument(a);
            }
        } else {
            walk::walk_call_expression(self, n);
        }
    }
    fn visit_spread_element(&mut self, n: &oxc_ast::ast::SpreadElement<'a>) {
        if !is_id(&n.argument, self.name) {
            walk::walk_spread_element(self, n);
        }
    }
    fn visit_for_statement_left(&mut self, n: &oxc_ast::ast::ForStatementLeft<'a>) {
        let was_writing = self.writing_target;
        self.writing_target = true;
        walk::walk_for_statement_left(self, n);
        self.writing_target = was_writing;
    }
    fn visit_for_of_statement(&mut self, n: &oxc_ast::ast::ForOfStatement<'a>) {
        self.visit_for_statement_left(&n.left);
        if !is_id(&n.right, self.name) {
            self.visit_expression(&n.right);
        }
        self.visit_statement(&n.body);
    }
    fn visit_assignment_expression(&mut self, n: &oxc_ast::ast::AssignmentExpression<'a>) {
        walk::walk_assignment_expression(self, n);
    }
    fn visit_update_expression(&mut self, n: &oxc_ast::ast::UpdateExpression<'a>) {
        if crate::rules::support::chain::simple_target_root(&n.argument).identifier()
            == Some(self.name)
        {
            self.bad = true;
        }
        walk::walk_update_expression(self, n);
    }
    fn visit_unary_expression(&mut self, n: &oxc_ast::ast::UnaryExpression<'a>) {
        if n.operator == oxc_syntax::operator::UnaryOperator::Typeof
            && is_id(&n.argument, self.name)
        {
            return;
        }
        if n.operator == oxc_syntax::operator::UnaryOperator::Delete {
            let target = match n.argument.get_inner_expression() {
                Expression::StaticMemberExpression(m) => Some(&m.object),
                Expression::ComputedMemberExpression(m) => Some(&m.object),
                _ => Some(&n.argument),
            };
            if target.is_some_and(|e| is_id(e, self.name)) {
                self.bad = true;
            }
        }
        if n.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
            && is_id(&n.argument, self.name)
        {
            return;
        }
        walk::walk_unary_expression(self, n);
    }
    fn visit_for_statement(&mut self, n: &oxc_ast::ast::ForStatement<'a>) {
        if let Some(test) = &n.test {
            if !is_id(test, self.name) {
                self.visit_expression(test);
            }
        }
        if let Some(init) = &n.init {
            self.visit_for_statement_init(init);
        }
        if let Some(update) = &n.update {
            self.visit_expression(update);
        }
        self.visit_statement(&n.body);
    }
    fn visit_binary_expression(&mut self, n: &oxc_ast::ast::BinaryExpression<'a>) {
        let safe = matches!(
            n.operator,
            oxc_syntax::operator::BinaryOperator::Equality
                | oxc_syntax::operator::BinaryOperator::Inequality
                | oxc_syntax::operator::BinaryOperator::StrictEquality
                | oxc_syntax::operator::BinaryOperator::StrictInequality
                | oxc_syntax::operator::BinaryOperator::LessThan
                | oxc_syntax::operator::BinaryOperator::LessEqualThan
                | oxc_syntax::operator::BinaryOperator::GreaterThan
                | oxc_syntax::operator::BinaryOperator::GreaterEqualThan
                | oxc_syntax::operator::BinaryOperator::In
                | oxc_syntax::operator::BinaryOperator::Instanceof
        );
        if safe {
            if !is_id(&n.left, self.name) {
                self.visit_expression(&n.left);
            }
            if !is_id(&n.right, self.name) {
                self.visit_expression(&n.right);
            }
        } else {
            walk::walk_binary_expression(self, n);
        }
    }
    fn visit_if_statement(&mut self, n: &oxc_ast::ast::IfStatement<'a>) {
        if !is_id(&n.test, self.name) {
            self.visit_expression(&n.test);
        }
        self.visit_statement(&n.consequent);
        if let Some(s) = &n.alternate {
            self.visit_statement(s);
        }
    }
    fn visit_while_statement(&mut self, n: &oxc_ast::ast::WhileStatement<'a>) {
        if !is_id(&n.test, self.name) {
            self.visit_expression(&n.test);
        }
        self.visit_statement(&n.body);
    }
    fn visit_do_while_statement(&mut self, n: &oxc_ast::ast::DoWhileStatement<'a>) {
        self.visit_statement(&n.body);
        if !is_id(&n.test, self.name) {
            self.visit_expression(&n.test);
        }
    }
    fn visit_conditional_expression(&mut self, n: &oxc_ast::ast::ConditionalExpression<'a>) {
        if !is_id(&n.test, self.name) {
            self.visit_expression(&n.test);
        }
        self.visit_expression(&n.consequent);
        self.visit_expression(&n.alternate);
    }
    fn visit_function(&mut self, n: &Function<'a>, f: oxc_syntax::scope::ScopeFlags) {
        if n.params
            .items
            .iter()
            .any(|p| parameter_identifier(&p.pattern).is_some_and(|i| i.name == self.name))
        {
            self.bad = true;
        }
        walk::walk_function(self, n, f)
    }
}
struct Finder<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}
impl<'a> Finder<'_> {
    fn report(
        &mut self,
        id: &BindingIdentifier<'a>,
        t: &TSType<'a>,
        body: &impl Fn(&mut Scan<'_>),
    ) {
        if let Some((start, end, text)) = array_type(t, self.source.text) {
            let mut scan = Scan {
                name: id.name.as_str(),
                bad: false,
                writing_target: false,
            };
            body(&mut scan);
            if !scan.bad {
                self.diagnostics.push(report_with_fix(
                    self.source,
                    id.span.start,
                    RULE,
                    format!(
                        concat!(
                            "Parameter '{}' is never mutated; accept `{}` so ",
                            "read-only store data can be passed without a copy."
                        ),
                        id.name, text
                    ),
                    Some(Fix { start, end, text }),
                ));
            }
        }
    }
}
impl<'a> Visit<'a> for Finder<'_> {
    fn visit_function(&mut self, f: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
        if !self.source.path.to_string_lossy().ends_with(".d.ts") {
            if let Some(b) = &f.body {
                for p in &f.params.items {
                    if let Some(id) = parameter_identifier(&p.pattern) {
                        if p.accessibility.is_none() && !p.readonly && !p.r#override {
                            if let Some(t) = &p.type_annotation {
                                self.report(id, &t.type_annotation, &|s| s.visit_function_body(b));
                            }
                        }
                    }
                }
            }
        }
        walk::walk_function(self, f, flags)
    }
    fn visit_arrow_function_expression(&mut self, a: &oxc_ast::ast::ArrowFunctionExpression<'a>) {
        if !self.source.path.to_string_lossy().ends_with(".d.ts") {
            for p in &a.params.items {
                if let (Some(id), Some(t)) = (parameter_identifier(&p.pattern), &p.type_annotation)
                {
                    self.report(id, &t.type_annotation, &|s| match &a.body {
                        ArrowFunctionBody::FunctionBody(b) => s.visit_function_body(b),
                        body => {
                            if let Some(e) = body.as_expression() {
                                s.visit_expression(e)
                            }
                        }
                    });
                }
            }
        }
        walk::walk_arrow_function_expression(self, a)
    }
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;
pub fn check(program: &Program<'_>, source: &Source, bases: &Bases) -> Vec<Diagnostic> {
    let _ = bases;
    let mut f = Finder {
        source,
        diagnostics: Vec::new(),
    };
    f.visit_program(program);
    f.diagnostics
}
