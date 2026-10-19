//! The folded capture minimum and the function frame it lives on.
//!
//! `MinDecl` folds, per frame, the lowest functional depth a runtime reference reaches, keeping
//! references to some ancestor's own symbol apart from ordinary captures: each such reference is
//! tagged with the index of the frame that owns the symbol, so it can die on that frame's exit —
//! for its owner the reference is recursion, not a capture, and nothing above the owner sees it
//! either. An entry exists only per distinct own symbol of a live ancestor actually referenced in
//! the subtree, and each entry climbs one frame per exit and dies on its owner, so the total cost
//! is the sum of (reference depth − owner index) over references to own symbols — O(N) for
//! ordinary code, worst case O(N·D) only under deep mutual recursion (as for the old
//! `CaptureProbe`, which re-walked the whole subtree per function).

use oxc_semantic::SymbolId;

/// One level of function nesting, carrying everything its exit decision needs.
pub(super) struct Frame {
    /// Whether it is an arrow, whose `this` and marks climb to its enclosure.
    pub(super) is_arrow: bool,
    /// The class depth on entry, which tells the function's own `this` apart from a nested
    /// class's.
    pub(super) class_base: usize,
    /// Whether the function needs the class it sits in, by class-bound syntax under it.
    pub(super) class_dep: bool,
    /// Whether the function sits inside a tracked-API call's arguments.
    pub(super) tracked: bool,
    /// Whether `this`/`super`/`arguments`/`new.target` below belongs to this chain of arrows.
    pub(super) marked: bool,
    /// This frame's position on the stack, which own-symbol references are tagged with.
    pub(super) index: usize,
    /// The lowest nonzero functional depth any runtime reference reaches, own ones tagged.
    pub(super) min_decl: MinDecl,
    /// The name the function is bound under, whose references are its recursion, not captures.
    pub(super) own_symbol: Option<SymbolId>,
}

/// The folded minimum reference depth of one frame, own-symbol references kept apart by owner.
pub(super) struct MinDecl {
    /// Minimum depth of references to symbols nobody on the stack owns, `usize::MAX` if none.
    base: usize,
    /// (owner frame index, minimum depth) per referenced own symbol of a live ancestor.
    owned: Vec<(usize, usize)>,
}

impl MinDecl {
    pub(super) fn new() -> Self {
        Self {
            base: usize::MAX,
            owned: Vec::new(),
        }
    }

    /// Folds one reference of the given depth, tagged with the owner of its symbol when the
    /// symbol is some ancestor frame's own.
    pub(super) fn fold(&mut self, owner: Option<usize>, depth: usize) {
        match owner {
            None => self.base = self.base.min(depth),
            Some(owner) => match self.owned.iter_mut().find(|(index, _)| *index == owner) {
                Some((_, minimum)) => *minimum = (*minimum).min(depth),
                None => self.owned.push((owner, depth)),
            },
        }
    }

    /// The minimum over every reference, own-symbol ones included: a candidate needs this above
    /// its own frame index to be free of captures.
    pub(super) fn own_minimum(&self) -> usize {
        self.owned
            .iter()
            .fold(self.base, |minimum, &(_, depth)| minimum.min(depth))
    }

    /// Passes this frame's fold up to its enclosure: ordinary and foreign-owner entries merge in,
    /// an entry for the parent's own symbol dies — the parent's recursion is no capture, and
    /// frames above the parent must not see it either.
    pub(super) fn merge_up(&self, parent: &mut MinDecl, parent_index: usize) {
        parent.base = parent.base.min(self.base);

        for &(index, depth) in &self.owned {
            if index < parent_index {
                parent.fold(Some(index), depth);
            }
        }
    }
}

impl Default for MinDecl {
    fn default() -> Self {
        Self::new()
    }
}
