use oxc_ast::ast::{
    AssignmentExpression, Class, Expression, MethodDefinition, Program, PropertyDefinition,
    StaticBlock, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, ScopeId, Scoping};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::support::chain::{chain_root, Base};

/// Every member-position occurrence of a member's name across the file. `this.<name>` and
/// `this.#<name>` inside the class being fixed — and nothing else — may be rewritten; every
/// other form (`other.name`, `obj["name"]`, `super.name`, `this.<name>` in another class of the
/// file, `ClassName.<name>` for a static) blocks the fix, because moving the member out only
/// stays safe while this file touches it exactly there.
pub(super) struct ReferenceScan<'n> {
    name: &'n str,
    /// The class the member would leave; its `this` is the only `this` a hit may be rooted at.
    class_span: Span,
    /// Whether the class being walked is the one being fixed, innermost last.
    classes: Vec<bool>,
    /// The receiver roots of class members currently being walked.
    member_roots: Vec<Span>,
    /// `this` does not denote the instance being rewritten in these contexts.
    unsafe_this: usize,
    /// Rewritable `this.<name>` / `this.#<name>` spans, with their nodes for scope lookup.
    pub(super) allowed: Vec<(Span, NodeId)>,
    /// A reference form the rewrite cannot account for was seen.
    pub(super) blocked: bool,
}

impl<'n> ReferenceScan<'n> {
    /// Records one member-position hit of the name: rewritable only when it is rooted at the
    /// fixed class's own `this` and no other class has been entered on the way down.
    fn hit(&mut self, span: Span, node: NodeId, rooted: bool) {
        if rooted && self.classes.last() == Some(&true) && self.unsafe_this == 0 {
            self.allowed.push((span, node));
        } else {
            self.blocked = true;
        }
    }
}

impl<'a, 'n> Visit<'a> for ReferenceScan<'n> {
    fn visit_class(&mut self, class: &Class<'a>) {
        self.classes.push(class.span == self.class_span);

        walk::walk_class(self, class);

        self.classes.pop();
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        self.member_roots.push(method.value.span);
        if method.r#static {
            self.unsafe_this += 1;
        }
        walk::walk_method_definition(self, method);
        if method.r#static {
            self.unsafe_this -= 1;
        }
        self.member_roots.pop();
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        let root = property
            .value
            .as_ref()
            .map(GetSpan::span)
            .unwrap_or(property.span);
        self.member_roots.push(root);
        let dynamic_function_field =
            matches!(property.value, Some(Expression::FunctionExpression(_)));
        if property.r#static || dynamic_function_field {
            self.unsafe_this += 1;
        }
        walk::walk_property_definition(self, property);
        if property.r#static || dynamic_function_field {
            self.unsafe_this -= 1;
        }
        self.member_roots.pop();
    }

    fn visit_static_block(&mut self, block: &StaticBlock<'a>) {
        self.unsafe_this += 1;
        walk::walk_static_block(self, block);
        self.unsafe_this -= 1;
    }

    fn visit_function(&mut self, function: &oxc_ast::ast::Function<'a>, flags: ScopeFlags) {
        let nested_receiver = self
            .member_roots
            .last()
            .is_some_and(|span| *span != function.span);
        if nested_receiver {
            self.unsafe_this += 1;
        }
        walk::walk_function(self, function, flags);
        if nested_receiver {
            self.unsafe_this -= 1;
        }
    }

    fn visit_expression(&mut self, expression: &Expression<'a>) {
        match expression {
            Expression::StaticMemberExpression(member) => {
                if member.property.name.as_str() == self.name {
                    // The same resolution `closures.rs` uses for this-chains: `this.a.<name>`
                    // is a hit on `a`, not on the member, and `super.<name>` is rooted at
                    // nothing the class owns.
                    let rooted = matches!(member.object, Expression::ThisExpression(_))
                        && !member.optional
                        && chain_root(expression).is_this_property(self.name);

                    self.hit(member.span, member.node_id(), rooted);
                }
            }
            Expression::PrivateFieldExpression(member) => {
                if member.field.name.as_str() == self.name {
                    let root = chain_root(&member.object);

                    // `this.a.#name` reads the private member off `a`, not off the instance.
                    let rooted = matches!(member.object, Expression::ThisExpression(_))
                        && !member.optional
                        && matches!(root.base, Base::This)
                        && root.base_property.is_none();

                    self.hit(member.span, member.node_id(), rooted);
                }
            }
            Expression::ComputedMemberExpression(member) => {
                if matches!(chain_root(&member.object).base, Base::This) {
                    self.blocked = true;
                }
            }
            _ => {}
        }

        walk::walk_expression(self, expression);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if self.classes.last() == Some(&true)
            && matches!(declarator.init, Some(Expression::ThisExpression(_)))
            && matches!(
                declarator.id,
                oxc_ast::ast::BindingPattern::ObjectPattern(_)
            )
        {
            self.blocked = true;
        }
        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        if self.classes.last() == Some(&true)
            && matches!(expression.right, Expression::ThisExpression(_))
            && matches!(
                expression.left,
                oxc_ast::ast::AssignmentTarget::ObjectAssignmentTarget(_)
            )
        {
            self.blocked = true;
        }
        walk::walk_assignment_expression(self, expression);
    }
}

/// Scans the whole file for member-position hits of `name`.
pub(super) fn scan_references<'n>(
    program: &Program<'_>,
    name: &'n str,
    class_span: Span,
) -> ReferenceScan<'n> {
    let mut scan = ReferenceScan {
        name,
        class_span,
        classes: Vec::new(),
        member_roots: Vec::new(),
        unsafe_this: 0,
        allowed: Vec::new(),
        blocked: false,
    };

    scan.visit_program(program);

    scan
}

/// Whether any scope from `scope` up to the module root binds `name` — what a bare `<name>` at
/// a rewritten reference site would resolve to once the member is a free function.
pub(super) fn shadowed_at(scoping: &Scoping, scope: ScopeId, name: &str) -> bool {
    scoping.scope_ancestors(scope).any(|scope| {
        scoping
            .iter_bindings_in(scope)
            .any(|symbol| scoping.symbol_name(symbol) == name)
    })
}

/// Whether a module-level binding — a top-level `const`/`let`/`var`/`function`/`class` or an
/// import — named `name` exists. The class's own name is one of these, so a member named after
/// its class stays unfixed too.
pub(super) fn module_binding(scoping: &Scoping, name: &str) -> bool {
    scoping
        .iter_bindings_in(scoping.root_scope_id())
        .any(|symbol| scoping.symbol_name(symbol) == name)
}
