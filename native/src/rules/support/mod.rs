//! What the rules share: the names carburetor code is recognised by, the statically knowable
//! names in the AST, and the one walk that tells a rule where it is.

pub mod bases;
pub mod chain;
pub mod names;
#[cfg(test)]
pub mod testing;
pub mod walk;
