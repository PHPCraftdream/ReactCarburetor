//! H18: a store created once per module in a project that renders on a server.
//!
//! On a server that instance is shared by every request in the process, so one user's state leaks
//! into another user's render. Locally, with one user, it behaves perfectly — this is the only
//! hazard in the catalogue whose symptom appears exclusively in production.
//!
//! Off by default, and deliberately so: a module-level store is the correct and recommended pattern
//! in a client-only application. A project that renders on a server turns it on and creates stores
//! through `CarburetorScope` instead, resolving them by token in `ScopedAntiHookComponent`.
//! See docs/hazards.md, H18.

use std::collections::HashSet;

use oxc_ast::ast::{
    ArrowFunctionExpression, Class, Expression, Function, NewExpression, Program,
};
use oxc_ast_visit::{walk, Visit};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::bases::CARBURETOR_BASES;
use crate::rules::support::names::extends_any;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-module-level-store";

struct Check {
    /// Depth of enclosing functions/classes; zero means the expression runs once, at module load.
    scope_depth: u32,
    /// Classes in this file that are stores, so a `new` of them is recognised by evidence.
    local_stores: HashSet<String>,
    suspects: Vec<(u32, String)>,
}

impl<'a> Visit<'a> for Check {
    fn visit_class(&mut self, class: &Class<'a>) {
        if extends_any(class, &CARBURETOR_BASES) {
            if let Some(id) = &class.id {
                self.local_stores.insert(id.name.to_string());
            }
        }

        self.scope_depth += 1;
        walk::walk_class(self, class);
        self.scope_depth -= 1;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        self.scope_depth += 1;
        walk::walk_function(self, function, flags);
        self.scope_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.scope_depth += 1;
        walk::walk_arrow_function_expression(self, arrow);
        self.scope_depth -= 1;
    }

    fn visit_new_expression(&mut self, expression: &NewExpression<'a>) {
        if self.scope_depth == 0 {
            if let Expression::Identifier(callee) = &expression.callee {
                self.suspects.push((expression.span.start, callee.name.to_string()));
            }
        }

        walk::walk_new_expression(self, expression);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check {
        scope_depth: 0,
        local_stores: HashSet::new(),
        suspects: Vec::new(),
    };

    check.visit_program(program);

    // Recognises a store by the convention the library's own classes follow, when it is not one
    // of the ones seen directly in this file's own class declarations.
    check
        .suspects
        .iter()
        .filter(|(_, name)| check.local_stores.contains(name) || name.ends_with("Carburetor"))
        .map(|(offset, name)| {
            let message = format!(
                "{name} is created once per module, so on a server every request shares this \
                 instance and one user's state appears in another user's render. Create it in a \
                 CarburetorScope per request and resolve it by token."
            );

            report(source, *offset, RULE, message)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_module_level_store_by_naming_convention_is_reported() {
        let source = "const store = new TodoCarburetor(api);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_local_class_extending_carburetor_is_recognised_by_evidence() {
        let source = "class Widget extends Carburetor {}\n\nconst store = new Widget();\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn an_instance_created_per_call_is_the_point_of_a_function() {
        let source = "function makeStore() {\n    return new TodoCarburetor(api);\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_instance_created_per_render_inside_a_class_is_not_module_level() {
        let source = "class Factory {\n    build() {\n        return new TodoCarburetor(api);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn something_that_is_not_a_store_by_name_or_evidence_is_left_alone() {
        let source = "const logger = new Logger();\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
