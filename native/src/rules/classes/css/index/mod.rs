//! The project-wide class index: every Palette token, Role and class the configured CSS defines,
//! with its floor and where it is defined. Built once per run before any file is checked, then
//! shared read-only by every rule.

use std::collections::{HashMap, HashSet};

use super::bricks::{classify, split, Colour};
use super::parse::Node;
use super::scan::{attribute_requirement, BlockKind, Floor, Scan};

pub mod usage;
use crate::rules::LineTable;

/// Where a name is defined: the file relative to the config root, and the 1-based line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub file: String,
    pub line: usize,
    pub offset: u32,
}

impl Location {
    /// `file:line`, as messages show it.
    pub fn label(&self) -> String {
        format!("{}:{}", self.file, self.line)
    }
}

/// One definition a file makes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Definition {
    pub name: String,
    pub floor: Floor,
    pub location: Location,
    /// For a class: what its body applies, as written (`hover:px-4`), and each declaration as an
    /// arbitrary property (`[width:auto]`), so a reader can expand it like a Brick list.
    pub applies: Vec<String>,
}

/// What one file contributes to the index.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileDefinitions {
    pub definitions: Vec<Definition>,
    /// The file's `@theme` carries `--color-*: initial`.
    pub color_reset: bool,
    /// State blocks: the Function, the attribute's name and the value it requires (`None`: any).
    pub states: Vec<(String, String, Option<String>)>,
    /// Every class an `@apply` of the file names, as written (see [`usage::usages`]).
    pub applied: Vec<String>,
    /// Every custom property the file reads through `var(--…)`, without the `--`.
    pub vars: Vec<String>,
}

/// The index itself. Every list of locations is in file order, then source order, so "the first
/// definition" is the same on every run whatever the thread schedule.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClassIndex {
    palette: HashMap<String, Vec<Location>>,
    roles: HashMap<String, Vec<Location>>,
    classes: HashMap<String, Vec<(Floor, Location)>>,
    applies: HashMap<String, Vec<String>>,
    /// Function → attribute → the values its state blocks select, or `None` once any block of that
    /// attribute matches values it cannot list.
    states: HashMap<String, HashMap<String, Option<Vec<String>>>>,
    /// Every class any stylesheet applies, as written; resolved by [`ClassIndex::finish`].
    applied: HashSet<String>,
    /// The bare utilities of `applied`: the classes something uses.
    used_classes: HashSet<String>,
    /// Custom properties read anywhere, without the `--`.
    used_vars: HashSet<String>,
    /// Roles a colour Brick of any `@apply` paints with.
    used_roles: HashSet<String>,
    color_reset: bool,
}

impl ClassIndex {
    /// Adds one file's definitions; files must be added in their sorted order.
    pub fn add(&mut self, file: FileDefinitions) {
        self.color_reset |= file.color_reset;
        self.applied.extend(file.applied);
        self.used_vars.extend(file.vars);

        for (function, attribute, value) in file.states {
            let values = self
                .states
                .entry(function)
                .or_default()
                .entry(attribute)
                .or_insert_with(|| Some(Vec::new()));
            match (values.as_mut(), value) {
                (Some(known), Some(value)) => {
                    if !known.contains(&value) {
                        known.push(value);
                    }
                }
                _ => *values = None,
            }
        }

        for definition in file.definitions {
            match definition.floor {
                Floor::Palette => self
                    .palette
                    .entry(definition.name)
                    .or_default()
                    .push(definition.location),
                Floor::Role => self
                    .roles
                    .entry(definition.name)
                    .or_default()
                    .push(definition.location),
                floor => {
                    self.applies
                        .entry(definition.name.clone())
                        .or_insert(definition.applies);
                    self.classes
                        .entry(definition.name)
                        .or_default()
                        .push((floor, definition.location));
                }
            }
        }
    }

    /// The floor of a class (Tone, Trait, Pattern, Function or an unplaced utility), by its first
    /// definition.
    pub fn floor(&self, class: &str) -> Option<Floor> {
        self.classes
            .get(class)
            .and_then(|definitions| definitions.first())
            .map(|(floor, _)| *floor)
    }

    /// Resolves what is used, once every file is added: a colour Brick names a Role only once all
    /// Roles are known.
    pub fn finish(&mut self) {
        let roles: HashSet<String> = self.roles.keys().cloned().collect();
        for class in &self.applied {
            let utility = split(class).utility;
            self.used_classes.insert(utility.to_string());
            if let Some(Colour::Role(role)) =
                classify(utility, &|name| roles.contains(name)).and_then(|brick| brick.colour)
            {
                self.used_roles.insert(role.to_string());
            }
        }
    }

    /// Whether some `@apply` names the class.
    pub fn is_class_used(&self, class: &str) -> bool {
        self.used_classes.contains(class)
    }

    /// Whether some value reads `--palette-<token>`.
    pub fn is_palette_used(&self, token: &str) -> bool {
        self.used_vars.contains(&format!("palette-{token}"))
    }

    /// Whether some colour Brick paints with the Role, or some value reads `--color-<role>`.
    pub fn is_role_used(&self, role: &str) -> bool {
        self.used_roles.contains(role) || self.used_vars.contains(&format!("color-{role}"))
    }

    /// The values a Function's state blocks select for an attribute, when they can all be listed;
    /// `None` when no state block reads the attribute or one matches values it cannot list.
    pub fn state_values(&self, function: &str, attribute: &str) -> Option<&[String]> {
        self.states.get(function)?.get(attribute)?.as_deref()
    }

    /// What a class's first definition applies (see [`Definition::applies`]); empty for a name no
    /// stylesheet defines.
    pub fn applies(&self, class: &str) -> &[String] {
        self.applies.get(class).map_or(&[], Vec::as_slice)
    }

    /// Whether a Role (the part after `--color-`) is defined in `@theme`.
    pub fn is_role(&self, name: &str) -> bool {
        self.roles.contains_key(name)
    }

    /// Whether a Palette token (the part after `--palette-`) is defined.
    pub fn is_palette(&self, name: &str) -> bool {
        self.palette.contains_key(name)
    }

    /// Whether any `@theme` resets the stock palette with `--color-*: initial`.
    pub fn has_color_reset(&self) -> bool {
        self.color_reset
    }

    /// The first definition of a name on a floor, for duplicate reports.
    pub fn first(&self, floor: Floor, name: &str) -> Option<&Location> {
        match floor {
            Floor::Palette => self
                .palette
                .get(name)
                .and_then(|locations| locations.first()),
            Floor::Role => self.roles.get(name).and_then(|locations| locations.first()),
            _ => self
                .classes
                .get(name)
                .and_then(|definitions| definitions.first())
                .map(|(_, location)| location),
        }
    }
}

/// What a block applies, in order: its `@apply` classes as written, and its declarations as
/// arbitrary properties.
fn body(nodes: &[Node], text: &str) -> Vec<String> {
    let mut applies = Vec::new();
    for node in nodes {
        match node {
            Node::At(rule) if rule.name.text(text).eq_ignore_ascii_case("apply") => applies.extend(
                crate::rules::classes::apply_classes(rule, text)
                    .into_iter()
                    .map(|applied| applied.class.to_string()),
            ),
            Node::Declaration(declaration) => {
                applies.push(format!("[{}:x]", declaration.name.text(text)));
            }
            _ => {}
        }
    }
    applies
}

/// The definitions one scanned file makes. `file` is its path relative to the config root.
pub fn definitions(scan: &Scan<'_>, text: &str, file: &str) -> FileDefinitions {
    let lines = LineTable::new(text);
    let mut result = FileDefinitions::default();
    let location = |offset: u32| Location {
        file: file.to_string(),
        line: lines.line(text, offset),
        offset,
    };

    for block in &scan.blocks {
        match block.kind {
            BlockKind::Theme | BlockKind::ThemeSelector => {
                for node in block.nodes {
                    let Node::Declaration(declaration) = node else {
                        continue;
                    };
                    let name = declaration.name.text(text);
                    if block.kind == BlockKind::Theme {
                        if name == "--color-*" {
                            result.color_reset |= declaration.value.text(text) == "initial";
                        } else if let Some(role) = name.strip_prefix("--color-") {
                            result.definitions.push(Definition {
                                name: role.to_string(),
                                floor: Floor::Role,
                                location: location(declaration.name.start),
                                applies: Vec::new(),
                            });
                        }
                    } else if let Some(token) = name.strip_prefix("--palette-") {
                        result.definitions.push(Definition {
                            name: token.to_string(),
                            floor: Floor::Palette,
                            location: location(declaration.name.start),
                            applies: Vec::new(),
                        });
                    }
                }
            }
            BlockKind::Utility { name, floor } => result.definitions.push(Definition {
                name: name.to_string(),
                floor,
                location: location(block.at),
                applies: body(block.nodes, text),
            }),
            BlockKind::Function { name } => result.definitions.push(Definition {
                name: name.to_string(),
                floor: Floor::Function,
                location: location(block.at),
                applies: body(block.nodes, text),
            }),
            BlockKind::State { name, attribute } => {
                if let Some((key, value)) = attribute_requirement(attribute) {
                    result.states.push((
                        name.to_string(),
                        key.to_string(),
                        value.map(str::to_string),
                    ));
                }
            }
            BlockKind::ClassOutside { .. } => {}
        }
    }

    result
}

#[cfg(test)]
mod tests;
