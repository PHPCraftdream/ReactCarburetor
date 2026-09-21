//! Following a member chain down to what it starts from.
//!
//! Every write rule needs the same answer: is this expression rooted at `this.draft`, at
//! `this.data`, at a `getData()` call, or at a local binding? Walking the chain in each rule would
//! repeat the same loop five times and get the computed-key case wrong in at least one of them.

use oxc_ast::ast::{AssignmentTarget, CallExpression, Expression, SimpleAssignmentTarget};

/// What a member chain starts from.
pub enum Base<'r, 'a> {
    /// `this.x.y`
    This,
    /// `store.x.y` — a binding, named here.
    Identifier(&'r str),
    /// `getData().x.y` — the call the chain hangs off.
    Call(&'r CallExpression<'a>),
    /// Anything else a chain can start with, which no rule asks about.
    Other,
}

/// A chain's origin, and the property applied directly to it — `data` in `this.data.items[id]`.
pub struct ChainRoot<'r, 'a> {
    pub base: Base<'r, 'a>,
    pub base_property: Option<&'r str>,
}

impl<'r, 'a> ChainRoot<'r, 'a> {
    /// Whether the chain is `this.<name>...`.
    pub fn is_this_property(&self, name: &str) -> bool {
        matches!(self.base, Base::This) && self.base_property == Some(name)
    }

    /// The binding a chain starts from, when it starts from one.
    pub fn identifier(&self) -> Option<&'r str> {
        match self.base {
            Base::Identifier(name) => Some(name),
            _ => None,
        }
    }

    /// The call a chain hangs off, when it hangs off one.
    pub fn call(&self) -> Option<&'r CallExpression<'a>> {
        match self.base {
            Base::Call(call) => Some(call),
            _ => None,
        }
    }
}

/// Follows an expression's member chain to its base.
///
/// Casts and parentheses are followed rather than treated as the base: `(this.data as any).x = 1` is
/// the same write as `this.data.x = 1`, and a cast is exactly what an author reaches for when the
/// read-only type complains — so stopping at one would lose the write that matters most.
pub fn chain_root<'r, 'a>(expression: &'r Expression<'a>) -> ChainRoot<'r, 'a> {
    let mut current = expression;
    let mut base_property: Option<&'r str> = None;

    loop {
        match current {
            Expression::StaticMemberExpression(member) => {
                base_property = Some(member.property.name.as_str());
                current = &member.object;
            }
            // A computed key is not knowable, so the property is forgotten while the walk goes on.
            Expression::ComputedMemberExpression(member) => {
                base_property = None;
                current = &member.object;
            }
            Expression::ParenthesizedExpression(inner) => current = &inner.expression,
            Expression::TSAsExpression(cast) => current = &cast.expression,
            Expression::TSSatisfiesExpression(cast) => current = &cast.expression,
            Expression::TSNonNullExpression(cast) => current = &cast.expression,
            Expression::TSTypeAssertion(cast) => current = &cast.expression,
            _ => break,
        }
    }

    let base = match current {
        Expression::ThisExpression(_) => Base::This,
        Expression::Identifier(identifier) => Base::Identifier(identifier.name.as_str()),
        Expression::CallExpression(call) => Base::Call(call),
        _ => Base::Other,
    };

    ChainRoot { base, base_property }
}

/// The same, for what `x++` changes, which the AST models as a simple assignment target.
pub fn simple_target_root<'r, 'a>(target: &'r SimpleAssignmentTarget<'a>) -> ChainRoot<'r, 'a> {
    match target {
        SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => ChainRoot {
            base: Base::Identifier(identifier.name.as_str()),
            base_property: None,
        },
        SimpleAssignmentTarget::StaticMemberExpression(member) => {
            let mut root = chain_root(&member.object);

            if root.base_property.is_none() {
                root.base_property = Some(member.property.name.as_str());
            }

            root
        }
        SimpleAssignmentTarget::ComputedMemberExpression(member) => chain_root(&member.object),
        SimpleAssignmentTarget::TSAsExpression(cast) => chain_root(&cast.expression),
        SimpleAssignmentTarget::TSNonNullExpression(cast) => chain_root(&cast.expression),
        SimpleAssignmentTarget::TSTypeAssertion(cast) => chain_root(&cast.expression),
        _ => ChainRoot { base: Base::Other, base_property: None },
    }
}

/// The same, for the left-hand side of an assignment, which the AST models as its own kind.
pub fn assignment_root<'r, 'a>(target: &'r AssignmentTarget<'a>) -> ChainRoot<'r, 'a> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => ChainRoot {
            base: Base::Identifier(identifier.name.as_str()),
            base_property: None,
        },
        AssignmentTarget::StaticMemberExpression(member) => {
            let mut root = chain_root(&member.object);

            // `this.data = x`: the object is the base itself, so this member's property is the one
            // applied to it. In `this.data.items = x` the walk already found `data`, which is the
            // property that matters — the innermost one, not this outer `items`.
            if root.base_property.is_none() {
                root.base_property = Some(member.property.name.as_str());
            }

            root
        }
        AssignmentTarget::ComputedMemberExpression(member) => chain_root(&member.object),
        // A cast is what people reach for when the read-only type complains, so a write through
        // one has to be followed rather than waved past.
        AssignmentTarget::TSAsExpression(cast) => chain_root(&cast.expression),
        AssignmentTarget::TSNonNullExpression(cast) => chain_root(&cast.expression),
        AssignmentTarget::TSTypeAssertion(cast) => chain_root(&cast.expression),
        _ => ChainRoot { base: Base::Other, base_property: None },
    }
}
