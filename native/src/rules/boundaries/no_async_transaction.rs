//! H17: an asynchronous body given to `transaction()` or `this.update()`.
//!
//! The rule fires on a bare `transaction()` only when the call resolves, through the semantic
//! model, to the symbol of a value import named `transaction` from `'react-carburetor'` — a
//! same-named binding defined locally is somebody else's API.
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
use oxc_semantic::{Semantic, SymbolId};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{called_on_this, member_call_name, referenced_symbol};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-async-transaction";

/// The symbols `transaction` is imported under from the library itself; a same-named import from
/// any other module is somebody else's API.
fn imported_transaction_symbols(program: &Program<'_>) -> HashSet<SymbolId> {
    let mut symbols = HashSet::new();

    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        if import.source.value != "react-carburetor" || import.import_kind != ImportOrExportKind::Value {
            continue;
        }

        for specifier in import.specifiers.iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else { continue };
            if specifier.import_kind != ImportOrExportKind::Value {
                continue;
            }

            let imported_name = match &specifier.imported {
                ModuleExportName::IdentifierName(name) => name.name.as_str(),
                ModuleExportName::IdentifierReference(name) => name.name.as_str(),
                ModuleExportName::StringLiteral(name) => name.value.as_str(),
            };

            if imported_name == "transaction" {
                if let Some(symbol) = specifier.local.symbol_id.get() {
                    symbols.insert(symbol);
                }
            }
        }
    }

    symbols
}

/// The batching call currently enclosing the walk, if the function being visited is its body.
struct Enclosing {
    span: Span,
    name: &'static str,
}

impl Clone for Enclosing {
    fn clone(&self) -> Self {
        *self
    }
}

impl Copy for Enclosing {}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    diagnostics: Vec<Diagnostic>,
    reported: HashSet<Span>,
    /// The batching call whose body the walk is currently inside, if any — only an `await` in the
    /// body itself closes the batch; awaits computing the call's own arguments are not part of
    /// the batch, and one in a nested function belongs to that function's own
    /// timeline, which is why entering any function clears this.
    enclosing: Option<Enclosing>,
    /// Marks the very next function entered as the batching call's body.
    pending_body: Option<Enclosing>,
    /// Symbols `transaction` was imported under; a bare call counts only for these.
    transactions: HashSet<SymbolId>,
}

impl<'a, 's> Check<'a, 's> {
    /// The name a batching call was made under, whether `transaction(...)` or `this.update(...)`.
    fn batching_name(&self, call: &CallExpression<'_>) -> Option<&'static str> {
        if let Expression::Identifier(identifier) = &call.callee {
            // The name may be aliased (e.g. `{ transaction as tx }`), so the set settles it all.
            if referenced_symbol(identifier, self.semantic)
                .is_some_and(|symbol| self.transactions.contains(&symbol))
            {
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

impl<'a, 's> Visit<'a> for Check<'a, 's> {
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

        self.visit_expression(&call.callee);

        for (index, argument) in call.arguments.iter().enumerate() {
            if index == 0
                && matches!(
                    argument,
                    Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_)
                )
            {
                self.pending_body = Some(Enclosing { span: call.span, name });
            }

            self.visit_argument(argument);

            self.pending_body = None;
        }
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let body = self.pending_body.take();
        // A nested function's awaits belong to its own timeline, not the batching call's.
        let outer = self.enclosing.take();
        self.enclosing = body;

        walk::walk_arrow_function_expression(self, arrow);

        self.enclosing = outer;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let body = self.pending_body.take();
        let outer = self.enclosing.take();
        self.enclosing = body;

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
    let semantic = build_semantic(program);
    let mut check = Check {
        source,
        semantic: &semantic,
        diagnostics: Vec::new(),
        reported: HashSet::new(),
        enclosing: None,
        pending_body: None,
        transactions: imported_transaction_symbols(program),
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
    fn a_transaction_imported_from_another_module_is_not_reported() {
        let source =
            "import {transaction} from './database';\n\ntransaction(async () => {\n    await save();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_parameter_shadowing_the_imported_transaction_is_not_reported() {
        let source = "import {transaction} from 'react-carburetor';\n\nfunction wrap(transaction: (cb: () => void) => void) {\n    transaction(async () => {\n        await save();\n    });\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_namespace_import_call_is_not_a_bare_transaction() {
        let source = "import * as C from 'react-carburetor';\n\nC.transaction(async () => {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_computing_the_transaction_argument_is_not_reported() {
        let source = "import {transaction} from 'react-carburetor';\n\nasync function run() {\n    transaction(await Promise.resolve(() => 42));\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_loading_the_callback_argument_is_not_reported() {
        let source = "import {transaction} from 'react-carburetor';\n\nasync function run() {\n    transaction(await makeCallback());\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_computing_the_update_argument_is_not_reported() {
        let source = "async function run() {\n    this.update(await getUpdater());\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_in_a_later_argument_evaluation_is_not_reported() {
        let source = "import {transaction} from 'react-carburetor';\n\nasync function run() {\n    transaction(cb, await x);\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_await_directly_in_the_transaction_body_is_reported() {
        // A non-async body cannot legally contain an await, so the smallest parseable positive is an async body.
        let source = "import {transaction} from 'react-carburetor';\n\ntransaction(async function handle() {\n    await load();\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }
}
