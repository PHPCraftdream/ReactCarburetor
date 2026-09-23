//! What the rules share: the names carburetor code is recognised by, the statically knowable
//! names in the AST, the one walk that tells a rule where it is, and the closure analysis that
//! tells an allocation rule what a closure would take with it.

pub mod bases;
pub mod chain;
pub mod closures;
pub mod names;
#[cfg(test)]
pub mod testing;
pub mod walk;
