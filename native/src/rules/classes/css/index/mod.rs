//! The project-wide class index: every Palette token, Role and class the configured CSS defines,
//! with its floor and where it is defined. Built once per run before any file is checked, then
//! shared read-only by every rule.

use std::collections::HashMap;

use super::parse::Node;
use super::scan::{BlockKind, Floor, Scan};
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
}

/// What one file contributes to the index.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileDefinitions {
    pub definitions: Vec<Definition>,
    /// The file's `@theme` carries `--color-*: initial`.
    pub color_reset: bool,
}

/// The index itself. Every list of locations is in file order, then source order, so "the first
/// definition" is the same on every run whatever the thread schedule.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClassIndex {
    palette: HashMap<String, Vec<Location>>,
    roles: HashMap<String, Vec<Location>>,
    classes: HashMap<String, Vec<(Floor, Location)>>,
    color_reset: bool,
}

impl ClassIndex {
    /// Adds one file's definitions; files must be added in their sorted order.
    pub fn add(&mut self, file: FileDefinitions) {
        self.color_reset |= file.color_reset;

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
                floor => self
                    .classes
                    .entry(definition.name)
                    .or_default()
                    .push((floor, definition.location)),
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
                            });
                        }
                    } else if let Some(token) = name.strip_prefix("--palette-") {
                        result.definitions.push(Definition {
                            name: token.to_string(),
                            floor: Floor::Palette,
                            location: location(declaration.name.start),
                        });
                    }
                }
            }
            BlockKind::Utility { name, floor } => result.definitions.push(Definition {
                name: name.to_string(),
                floor,
                location: location(block.at),
            }),
            BlockKind::Function { name } => result.definitions.push(Definition {
                name: name.to_string(),
                floor: Floor::Function,
                location: location(block.at),
            }),
            BlockKind::State { .. } | BlockKind::ClassOutside { .. } => {}
        }
    }

    result
}

#[cfg(test)]
mod tests;
