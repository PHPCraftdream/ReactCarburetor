use super::*;

/// Whether the member's signature and body need the class it was written in.
pub(super) fn member_class_dependency<'a>(
    root: &Root<'a>,
    member_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    let type_parameters = class_type_parameters(semantic, member_id);
    let mut scan = DependencyScan {
        type_parameters: &type_parameters,
        scoping: semantic.scoping(),
        found: false,
    };

    root.visit(&mut scan);

    scan.found
}

/// The enclosing class's own type parameters, which name the class without naming it.
pub(super) fn class_type_parameters(semantic: &Semantic<'_>, member_id: NodeId) -> Vec<SymbolId> {
    semantic
        .nodes()
        .ancestor_kinds(member_id)
        .find_map(|kind| match kind {
            AstKind::Class(class) => Some(class),
            _ => None,
        })
        .map_or_else(Vec::new, |class| {
            class
                .type_parameters
                .as_ref()
                .map_or_else(Vec::new, |declaration| {
                    declaration
                        .params
                        .iter()
                        .filter_map(|parameter| parameter.name.symbol_id.get())
                        .collect()
                })
        })
}

/// Looks for the nodes that tie a member or a closure to the class it was written in.
pub(super) struct DependencyScan<'s> {
    /// The enclosing class's own type parameters, by resolved identity.
    pub(super) type_parameters: &'s [SymbolId],
    pub(super) scoping: &'s Scoping,
    pub(super) found: bool,
}

impl<'a, 's> Visit<'a> for DependencyScan<'s> {
    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_this_expression(&mut self, expression: &ThisExpression) {
        self.found = true;

        walk::walk_this_expression(self, expression);
    }

    fn visit_super(&mut self, expression: &Super) {
        self.found = true;

        walk::walk_super(self, expression);
    }

    fn visit_private_field_expression(&mut self, expression: &PrivateFieldExpression<'a>) {
        self.found = true;

        walk::walk_private_field_expression(self, expression);
    }

    fn visit_private_in_expression(&mut self, expression: &PrivateInExpression<'a>) {
        self.found = true;

        walk::walk_private_in_expression(self, expression);
    }

    fn visit_ts_this_type(&mut self, expression: &TSThisType) {
        self.found = true;

        walk::walk_ts_this_type(self, expression);
    }

    fn visit_ts_type_name(&mut self, name: &TSTypeName<'a>) {
        if matches!(name, TSTypeName::ThisExpression(_)) {
            self.found = true;
        }

        walk::walk_ts_type_name(self, name);
    }

    fn visit_ts_type_reference(&mut self, reference: &TSTypeReference<'a>) {
        if let TSTypeName::IdentifierReference(name) = &reference.type_name {
            let symbol = name
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id());
            if symbol.is_some_and(|symbol| self.type_parameters.contains(&symbol)) {
                self.found = true;
            }
        }

        walk::walk_ts_type_reference(self, reference);
    }
}

/// Collects the resolved references inside one candidate, in first-use order.
pub(super) struct CaptureCollector<'a, 's> {
    pub(super) scoping: &'s Scoping,
    pub(super) symbols: Vec<SymbolId>,
    pub(super) names: Vec<&'a str>,
    pub(super) written: Vec<bool>,
}

impl<'a> Visit<'a> for CaptureCollector<'a, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference_id) = identifier.reference_id.get() else {
            return;
        };
        let reference = self.scoping.get_reference(reference_id);
        let flags = reference.flags();

        // A TypeScript type position carries neither Read nor Write, and oxc's binder has already
        // worked out which is which.
        if !flags.intersects(ReferenceFlags::Read | ReferenceFlags::Write) {
            return;
        }

        let Some(symbol) = reference.symbol_id() else {
            return;
        };

        if let Some(index) = self.symbols.iter().position(|held| *held == symbol) {
            self.written[index] |= flags.contains(ReferenceFlags::Write);

            return;
        }

        self.symbols.push(symbol);
        self.names.push(identifier.name.as_str());
        self.written.push(flags.contains(ReferenceFlags::Write));
    }
}

/// Whether anything in the member assigns to `symbol` after it was initialised.
pub(super) fn written_after_init(
    symbol: SymbolId,
    semantic: &Semantic<'_>,
    member_span: Span,
) -> bool {
    semantic
        .scoping()
        .get_resolved_references(symbol)
        .any(|reference| {
            reference.flags().contains(ReferenceFlags::Write)
                && contains(member_span, semantic.reference_span(reference))
        })
}

/// Whether `symbol` was destructured straight off `this`: `const { id } = this.data`.
pub(super) fn this_derived(
    symbol: SymbolId,
    semantic: &Semantic<'_>,
    written_after_init: bool,
) -> bool {
    // A closure that writes the binding owns it rather than reading it out of the class.
    if written_after_init {
        return false;
    }

    let AstKind::VariableDeclarator(declarator) = semantic.symbol_declaration(symbol).kind() else {
        return false;
    };
    let AstKind::VariableDeclaration(declaration) =
        semantic.nodes().parent_kind(declarator.node_id())
    else {
        return false;
    };

    declaration.kind == VariableDeclarationKind::Const
        && declarator
            .init
            .as_ref()
            .is_some_and(|init| is_this_chain(init))
        && pattern_binds(&declarator.id, symbol)
}

/// Whether `symbol` is bound by a plain property of the pattern's object part.
///
/// A rest element is a different shape from the property it shadows, and an array pattern says
/// nothing about where the value came from, so neither counts.
fn pattern_binds(pattern: &BindingPattern<'_>, symbol: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id.get() == Some(symbol),
        BindingPattern::AssignmentPattern(pattern) => pattern_binds(&pattern.left, symbol),
        BindingPattern::ObjectPattern(object) => object
            .properties
            .iter()
            .any(|property| pattern_binds(&property.value, symbol)),
        BindingPattern::ArrayPattern(_) => false,
    }
}

/// Whether an expression is a chain of plain members hanging off `this`.
fn is_this_chain(expression: &Expression<'_>) -> bool {
    // `chain_root` walks past a computed member and still reports `Base::This`, which is why the
    // walk is redone here: a computed key or a call makes the chain unknowable.
    matches!(chain_root(expression).base, Base::This)
        && match expression {
            Expression::StaticMemberExpression(member) => is_this_chain(&member.object),
            Expression::ParenthesizedExpression(inner) => is_this_chain(&inner.expression),
            Expression::TSAsExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSSatisfiesExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSNonNullExpression(cast) => is_this_chain(&cast.expression),
            Expression::TSTypeAssertion(cast) => is_this_chain(&cast.expression),
            Expression::ThisExpression(_) => true,
            _ => false,
        }
}

/// Whether a closure is nothing but forwarding to a method: `() => this.m(a, b)`.
pub(super) fn forwarder<'a>(
    arrow: &ArrowFunctionExpression<'a>,
    scoping: &Scoping,
) -> Option<Forwarder<'a>> {
    if arrow.params.rest.is_some() {
        return None;
    }

    // A plain identifier per parameter: a pattern, a default or a rest would have to be carried
    // over as well, and a forwarder that carries anything is not one.
    let parameters = arrow
        .params
        .items
        .iter()
        .map(|parameter| {
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };

            if parameter.initializer.is_some() {
                return None;
            }

            identifier.symbol_id.get()
        })
        .collect::<Option<Vec<_>>>()?;

    let expression = match &arrow.body {
        ArrowFunctionBody::FunctionBody(body) => {
            let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                return None;
            };

            statement.argument.as_ref()?
        }
        _ => arrow.body.as_expression()?,
    };

    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return None;
    };

    if !matches!(member.object, Expression::ThisExpression(_)) {
        return None;
    }

    // The call forwards the parameters, in the order they were declared, and nothing else: a
    // computed or captured argument would make the method body depend on the closure it came from.
    let forwards = call.arguments.len() == parameters.len()
        && call
            .arguments
            .iter()
            .zip(&parameters)
            .all(|(argument, parameter)| match argument.as_expression() {
                Some(Expression::Identifier(identifier)) => identifier
                    .reference_id
                    .get()
                    .is_some_and(|id| scoping.get_reference(id).symbol_id() == Some(*parameter)),
                _ => false,
            });

    forwards.then(|| Forwarder {
        method: member.property.name.as_str(),
    })
}
