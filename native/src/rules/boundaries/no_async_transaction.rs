//! H17: an asynchronous body given to `transaction()` or `this.update()`.
//!
//! The rule fires on a bare `transaction()` only when the file imports `transaction` from the
//! library — a same-named binding defined locally is somebody else's API.
//!
//! Both are open only while the body runs synchronously. At the first `await` the body returns a
//! promise, the batch closes, and every write after the await is delivered on its own — so the
//! batching silently does nothing, and in `update()`'s case the later writes are never published at
//! all. Development reports both at runtime; the rule catches the paths that never ran. The fix is
//! always the same shape: do the asynchronous work first, then wrap the synchronous block of writes.
//! See docs/hazards.md, H17.

use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrowFunctionExpression, AwaitExpression, CallExpression, Expression, Function,
    ImportDeclarationSpecifier, ImportOrExportKind, ModuleExportName, Program, Statement,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::names::{called_on_this, member_call_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-async-transaction";

/// The local names `transaction` is imported under: `import {transaction}`, `import {transaction as t}`.
fn imported_transaction_names(program: &Program<'_>) -> HashSet<String> {
    let mut names = HashSet::new();

    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };

        if import.import_kind != ImportOrExportKind::Value {
            continue;
        }

        for specifier in import.specifiers.iter().flatten() {
            let (local, imported) = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    if specifier.import_kind != ImportOrExportKind::Value {
                        continue;
                    }

                    (&specifier.local, Some(&specifier.imported))
                }
                // A default or namespace import binds the name it declares.
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    (&specifier.local, None)
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    (&specifier.local, None)
                }
            };

            let matches = match imported {
                Some(imported) => match imported {
                    ModuleExportName::IdentifierName(name) => name.name == "transaction",
                    ModuleExportName::IdentifierReference(name) => name.name == "transaction",
                    ModuleExportName::StringLiteral(name) => name.value == "transaction",
                },
                // No explicit imported name: the local binding is the imported one.
                None => local.name == "transaction",
            };

            if matches {
                names.insert(local.name.to_string());
            }
        }
    }

    names
}

/// The batching call currently enclosing the walk, if the function being visited is its body.
struct Enclosing {
    span: Span,
    name: &'static str,
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    reported: HashSet<Span>,
    /// The batching call whose body the walk is currently inside, if any — only an `await` in the
    /// body itself closes the batch; one in a nested function belongs to that function's own
    /// timeline, which is why entering any function clears this.
    enclosing: Option<Enclosing>,
    /// Local names `transaction` was imported under; a bare call counts only under these.
    transactions: HashSet<String>,
}

impl<'s> Check<'s> {
    /// The name a batching call was made under, whether `transaction(...)` or `this.update(...)`.
    fn batching_name(&self, call: &CallExpression<'_>) -> Option<&'static str> {
        if let Expression::Identifier(identifier) = &call.callee {
            // The set only ever holds names bound to an imported `transaction`.
            if self.transactions.contains(identifier.name.as_str()) {
                return Some("transaction");
            }
        }

        ((member_call_name(&call.callee) == Some("update")) && called_on_this(&call.callee))
            .then_some("update")
    }

    fn report_once(&mut self, span: Span, name: &str) {
        if !self.reported.insert(span) {
            return;
        }

        let message = format!(
            "{name}() is open only while its body runs synchronously: at the first await the body \
             returns a promise and the batch closes, so the writes that follow are delivered \
             separately — or, for update(), never published at all. Do the asynchronous work first, \
             then {name}() the synchronous writes."
        );

        self.diagnostics.push(report(self.source, span.start, RULE, message));
    }
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let Some(name) = self.batching_name(call) else {
            walk::walk_call_expression(self, call);

            return;
        };

        let is_async_body = matches!(
            call.arguments.first(),
            Some(Argument::ArrowFunctionExpression(body)) if body.r#async
        ) || matches!(
            call.arguments.first(),
            Some(Argument::FunctionExpression(body)) if body.r#async
        );

        if is_async_body {
            self.report_once(call.span, name);
        }

        let outer = self.enclosing.replace(Enclosing { span: call.span, name });

        walk::walk_call_expression(self, call);

        self.enclosing = outer;
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        // A nested function's awaits belong to its own timeline, not the batching call's.
        let outer = self.enclosing.take();

        walk::walk_arrow_function_expression(self, arrow);

        self.enclosing = outer;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let outer = self.enclosing.take();

        walk::walk_function(self, function, flags);

        self.enclosing = outer;
    }

    fn visit_await_expression(&mut self, expression: &AwaitExpression<'a>) {
        if let Some(enclosing) = &self.enclosing {
            let (span, name) = (enclosing.span, enclosing.name);

            self.report_once(span, name);
        }

        walk::walk_await_expression(self, expression);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        diagnostics: Vec::new(),
        reported: HashSet::new(),
        enclosing: None,
        transactions: imported_transaction_names(program),
    };

    check.visit_program(program);

    check.diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_async_transaction_body_is_reported() {
        let source =
            "import {transaction} from 'react-carburetor';\n\ntransaction(async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_transaction_imported_under_another_name_is_reported_by_that_name() {
        let source =
            "import {transaction as tx} from 'react-carburetor';\n\ntx(async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_bare_transaction_without_an_import_is_not_reported() {
        // A local binding of the same name is somebody else's API.
        let source =
            "const db = {transaction: (cb) => cb()};\n\ntransaction(async () => {\n    await x();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_type_only_import_is_not_a_transaction() {
        let source =
            "import type {transaction} from 'react-carburetor';\n\ntransaction(async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_in_a_nested_iife_does_not_close_the_outer_batch() {
        // The IIFE is a function boundary of its own, same as the JS rule's findEnclosingFunction.
        let source = "import {transaction} from 'react-carburetor';\n\ntransaction(() => {\n    void (async () => {\n        await load();\n    })();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_async_update_body_is_reported() {
        let source = "this.update(async (draft) => {\n    await load();\n    draft.x = 1;\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_synchronous_transaction_is_correct() {
        let source = "import {transaction} from 'react-carburetor';\n\ntransaction(() => {\n    store.a.set(1);\n    store.b.set(2);\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_in_a_nested_function_belongs_to_its_own_timeline() {
        let source = "import {transaction} from 'react-carburetor';\n\ntransaction(() => {\n    const later = async () => {\n        await load();\n    };\n\n    later();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn each_offending_call_is_reported_only_once() {
        let source = "this.update(async (draft) => {\n    await a();\n    await b();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn an_update_call_on_a_foreign_receiver_is_not_reported() {
        // `update` is a protected method of the component; an unrelated object's `update` is not a batch.
        let source = "const api = {update: async (cb) => cb()};\n\napi.update(async () => {\n    await save();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_store_update_call_is_not_reported() {
        let source = "store.update(async (draft) => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_nested_receiver_update_call_is_not_reported() {
        let source = "this.props.x.update(async (draft) => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
