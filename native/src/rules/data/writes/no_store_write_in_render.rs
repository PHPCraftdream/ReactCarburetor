//! H11: a call that changes a store while a component renders.
//!
//! With the default scheduler the write notifies subscribers during the render. In the lucky case
//! that costs an extra pass; in the unlucky one React reports a maximum-update-depth error far from
//! the cause, or an abandoned concurrent render has already changed the state other components see.
//! Writes belong in `useEffects`, in a handler, or in a resource load.
//!
//! A store is identified by evidence rather than by a naming convention: whatever is passed to
//! `this.useCarburetor(...)`, `this.useComputed(...)`, or `this.useResource(...)` anywhere in the
//! file is one, matched by resolved root binding and static member chain (and class identity for
//! `this`), so `this.props.carburetor` works as well as an imported singleton.
//! A component that writes to a store it never reads is not detected. See docs/hazards.md, H11.

use std::collections::HashSet;

use oxc_ast::ast::{CallExpression, Expression, Program};
use oxc_semantic::{Semantic, SymbolId};
use oxc_span::GetSpan;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{called_on_this, member_call_name};
use crate::rules::support::walk::{walk_rule, Context, RenderKind, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-store-write-in-render";

/// Calls that only read, and are therefore fine in render.
const READ_METHODS: [&str; 12] = [
    "getData",
    "getVersion",
    "getUID",
    "getLastError",
    "snapshot",
    "toJSON",
    "read",
    "get",
    "getEntry",
    // `getFailure` and `resolve` are the read half of a resource source: neither publishes, so
    // both are fine in render.
    "getFailure",
    "resolve",
    // `suspend()` does write — it starts the request and marks the resource pending — but it is
    // built for exactly this position: the notification is deferred to a microtask precisely
    // because a render must not notify. Reporting it would flag the documented way to use Suspense.
    "suspend",
];

/// Reads that identify their argument as a store, a computed, or a resource.
const TRACKING_READS: [&str; 3] = ["useCarburetor", "useComputed", "useResource"];

/// A write in render, waiting to be judged once the file has revealed what its stores are.
struct Suspect {
    offset: u32,
    receiver: Option<StoreKey>,
    receiver_text: String,
    unresolved_root: bool,
    method: String,
    render_kind: Option<RenderKind>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum RootKey {
    Symbol(SymbolId),
    This(Option<oxc_span::Span>),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct StoreKey {
    root: RootKey,
    chain: Vec<String>,
}

struct Check<'s> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'s>,
    stores: HashSet<StoreKey>,
    unresolved_stores: HashSet<(String, Option<oxc_span::Span>)>,
    suspects: Vec<Suspect>,
}

impl<'s> Check<'s> {
    fn store_key(
        &self,
        expression: &Expression<'_>,
        class_span: Option<oxc_span::Span>,
    ) -> Option<StoreKey> {
        match expression {
            Expression::Identifier(identifier) => identifier
                .reference_id
                .get()
                .and_then(|id| self.semantic.scoping().get_reference(id).symbol_id())
                .map(|symbol| StoreKey {
                    root: RootKey::Symbol(symbol),
                    chain: Vec::new(),
                }),
            Expression::ThisExpression(_) => Some(StoreKey {
                root: RootKey::This(class_span),
                chain: Vec::new(),
            }),
            Expression::StaticMemberExpression(member) => {
                let mut key = self.store_key(&member.object, class_span)?;
                key.chain.push(member.property.name.to_string());
                Some(key)
            }
            _ => None,
        }
    }

    fn text(&self, expression: &Expression<'_>) -> String {
        let span = expression.span();
        self.source.text[span.start as usize..span.end as usize].to_string()
    }

    fn unresolved_root(&self, expression: &Expression<'_>) -> bool {
        match expression {
            Expression::Identifier(identifier) => identifier
                .reference_id
                .get()
                .and_then(|id| self.semantic.scoping().get_reference(id).symbol_id())
                .is_none(),
            Expression::StaticMemberExpression(member) => self.unresolved_root(&member.object),
            _ => false,
        }
    }
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(&mut self) -> Vec<Diagnostic> {
        self.suspects
            .iter()
            .filter(|suspect| {
                suspect
                    .receiver
                    .as_ref()
                    .is_some_and(|receiver| self.stores.contains(receiver))
                    || (suspect.unresolved_root
                        && self
                            .unresolved_stores
                            .contains(&(suspect.receiver_text.clone(), None)))
            })
            .map(|suspect| {
                let advice = if suspect.render_kind == Some(RenderKind::Function) {
                    "Write from an event handler or resource action."
                } else {
                    "Write from useEffects, from an event handler, or from a resource load."
                };
                let message = format!(
                    "{}() changes a store while this component renders, which notifies subscribers \
                     mid-render: at best an extra pass, at worst an update loop React reports far \
                     from here. {}",
                    suspect.method, advice
                );

                report(self.source, suspect.offset, RULE, message)
            })
            .collect()
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        let method = member_call_name(&call.callee).or_else(|| {
            let Expression::Identifier(identifier) = &call.callee else {
                return None;
            };
            Some(identifier.name.as_str())
        });
        let Some(method) = method else {
            return;
        };

        if ["useCarburetorValue", "useComputedValue", "useResourceValue"].contains(&method)
            && !called_on_this(&call.callee)
        {
            if let Some(source) = call
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
            {
                let key = self.store_key(source, context.class_span);
                if let Some(key) = key {
                    self.stores.insert(key);
                } else if self.unresolved_root(source) {
                    self.unresolved_stores.insert((self.text(source), None));
                }
            }
        }

        // Whatever is read as a store is a store, wherever in the file that read happens.
        if TRACKING_READS.contains(&method) {
            if let Some(source) = call
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
            {
                if let Some(key) = self.store_key(source, context.class_span) {
                    self.stores.insert(key);
                } else if self.unresolved_root(source) {
                    self.unresolved_stores.insert((self.text(source), None));
                }
            }

            return;
        }

        if READ_METHODS.contains(&method) || !context.in_render {
            return;
        }

        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return;
        };

        self.suspects.push(Suspect {
            offset: call.span.start,
            receiver: self.store_key(&callee.object, context.class_span),
            receiver_text: self.text(&callee.object),
            unresolved_root: self.unresolved_root(&callee.object),
            method: method.to_string(),
            render_kind: context.render_kind,
        });
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic, bases)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a, 's>(
    program: &'a Program<'a>,
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    bases: &Bases,
) -> Vec<Diagnostic> {
    walk_rule(program, make_rule(source, semantic), bases)
}

/// Builds the rule state for a shared semantic pass.
pub(in crate::rules) fn make_rule<'a, 's>(
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
) -> impl Rule<'a> + 's {
    Check { source, semantic, stores: HashSet::new(), unresolved_stores: HashSet::new(), suspects: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_write_to_a_store_read_in_render_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        store.rename('x');\n        \
                      return d.name;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_read_only_call_is_fine_in_render() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        return store.snapshot();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn suspend_is_built_for_render() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(resource);\n        return resource.suspend(1);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_resource_clear_from_a_handler_is_fine() {
        // `clear` is a resource handle built for event handlers: outside render it is not a write.
        // The handler must clear the resource itself, not the view returned by useResource.
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      this.useResource(cache, 1);\n        \
                      return <b onClick={() => cache.clear()}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_resource_clear_in_render_is_still_reported() {
        // `clear` is not in READ_METHODS: clearing notifies subscribers mid-render, as before.
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      this.useResource(cache, 1);\n        cache.clear();\n        \
                      return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_resource_load_in_render_is_reported() {
        // `useResource` names the cache as tracked, and `load` notifies its subscribers mid-render:
        // the same hazard this rule exists to catch.
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      this.useResource(cache, 1);\n        cache.load(1);\n        \
                      return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn a_get_failure_call_is_a_plain_read_in_render() {
        let source = "class Widget extends AntiHookComponent {
    render() {
                              this.useResource(cache, 1);
        return cache.getFailure(1);
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_resolve_call_is_a_plain_read_in_render() {
        let source = "class Widget extends AntiHookComponent {
    render() {
                              this.useResource(cache, 1);
        return cache.resolve(1);
    }
}
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_get_entry_call_is_a_plain_read_in_render() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(cache);\n        \
                      return cache.getEntry(1);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_write_from_a_handler_is_where_writes_belong() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(store);\n        \
                      return <b onClick={() => store.rename('x')}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_receiver_that_was_never_read_as_a_store_is_not_one() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      logger.write('x');\n        return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_store_reached_through_props_is_compared_by_its_text() {
        let source = "class Widget extends AntiHookComponent {\n    render() {\n        \
                      const d = this.useCarburetor(this.props.carburetor);\n        \
                      this.props.carburetor.rename('x');\n        return d.name;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [4]);
    }

    #[test]
    fn round_four_identical_function_params_keep_store_evidence_local() {
        let source = "function Reader({source}) { const value = useCarburetorValue(source); return <div>{value}</div>; }\n\
                      function Writer({source}) { source.clear(); return <div />; }\n";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn round_four_block_shadow_does_not_inherit_outer_store_evidence() {
        let source = "function View({source}) { const value = useCarburetorValue(source); { const source = new Map(); source.clear(); } return <div>{value}</div>; }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn round_four_write_to_outer_store_is_reported() {
        let source = "function View({source}) { const value = useCarburetorValue(source); source.clear(); return <div>{value}</div>; }";
        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn round_four_class_and_function_store_evidence_stays_separate() {
        let source = "class Reader extends AntiHookComponent { render() { const value = this.useCarburetor(this.props.store); return value; } }\n\
                      class Writer extends AntiHookComponent { render() { this.props.store.clear(); return null; } }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_props_store_does_not_cross_class_identity() {
        let source = "class Reader extends AntiHookComponent { render() { this.useCarburetor(this.props.store); return null; } }\nclass Writer extends AntiHookComponent { render() { this.props.store.clear(); return null; } }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_props_store_write_is_reported_in_same_class() {
        let source = "class Widget extends AntiHookComponent { render() { this.useCarburetor(this.props.store); this.props.store.clear(); return null; } }";
        assert_eq!(lines(&diagnose(source, check)), [1]);
    }
    #[test]
    fn mixed_class_and_function_store_evidence_stays_separate() {
        let source = "class Reader extends AntiHookComponent { render() { this.useCarburetor(this.props.store); return null; } }\nfunction Writer({store}) { store.clear(); return <div />; }";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_store_read_elsewhere_in_the_file_still_counts() {
        // The evidence does not have to be in the same component: one read anywhere names the store.
        let source = "class Reader extends AntiHookComponent {\n    render() {\n        \
                      return this.useCarburetor(store).name;\n    }\n}\n\n\
                      class Writer extends AntiHookComponent {\n    render() {\n        \
                      store.rename('x');\n        return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [9]);
    }
}
