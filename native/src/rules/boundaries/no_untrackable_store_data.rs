//! H19: an untrackable value in a store's data.
//!
//! Tracking stops at `Map`, `Set`, `Date` and class instances. Reads of them are coarse — the whole
//! value is one leaf — an in-place change through `draft` invalidates that whole value, and the same
//! change through `this.data` invalidates the entire store. Everything keeps working, at a
//! granularity that quietly defeats the point of the library. `snapshot()` also shares these values
//! by reference instead of copying them, so undo does not restore them.
//!
//! Detection follows the declared shape: the interface a store is parameterised with
//! (`class X extends Carburetor<IData>`) and the initial-data object handed to its constructor.
//! See docs/hazards.md, H19.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    Class, Expression, Function, NewExpression, Program, TSInterfaceDeclaration, TSSignature,
    TSType, TSTypeName, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::bases::CARBURETOR_BASES;
use crate::rules::support::names::extends_any;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-untrackable-store-data";

/// Values the tracking proxies pass through untouched.
const UNTRACKABLE: [&str; 5] = ["Map", "Set", "WeakMap", "WeakSet", "Date"];

/// Whether a name follows the initial-data factory convention this library itself uses.
fn is_factory_name(name: &str) -> bool {
    for prefix in ["get", "create", "make"] {
        if let Some(rest) = name.strip_prefix(prefix) {
            if rest.starts_with("Initial") || rest.starts_with("Default") {
                return true;
            }
        }
    }

    false
}

/// The name a type reference was written under, bare identifiers only.
fn type_reference_name<'a>(name: &'a TSTypeName<'_>) -> Option<&'a str> {
    match name {
        TSTypeName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

struct Check {
    /// Names of the interfaces stores in this file are parameterised with.
    data_types: HashSet<String>,
    /// Interface name -> its body, so a reported field can be judged as being inside store data.
    declarations: HashMap<String, Span>,
    /// A field annotation naming an untrackable type, and the interface body it sits in.
    annotations: Vec<(u32, String, Span)>,
    /// A `new Map()` etc. built by an initial-data factory.
    constructions: Vec<(u32, String)>,
    /// Whether the walk is currently inside a `super(...)` call or a factory-named body.
    factory_depth: u32,
}

impl<'a> Visit<'a> for Check {
    fn visit_class(&mut self, class: &Class<'a>) {
        if extends_any(class, &CARBURETOR_BASES) {
            if let Some(name) = class
                .heritage
                .as_ref()
                .and_then(|heritage| heritage.type_arguments.as_ref())
                .and_then(|arguments| arguments.params.first())
                .and_then(|param| match param {
                    TSType::TSTypeReference(reference) => type_reference_name(&reference.type_name),
                    _ => None,
                })
            {
                self.data_types.insert(name.to_string());
            }
        }

        walk::walk_class(self, class);
    }

    fn visit_ts_interface_declaration(&mut self, declaration: &TSInterfaceDeclaration<'a>) {
        self.declarations.insert(declaration.id.name.to_string(), declaration.body.span);

        for signature in &declaration.body.body {
            if let TSSignature::TSPropertySignature(property) = signature {
                if let Some(annotation) = &property.type_annotation {
                    if let TSType::TSTypeReference(reference) = &annotation.type_annotation {
                        if let Some(name) = type_reference_name(&reference.type_name) {
                            if UNTRACKABLE.contains(&name) {
                                self.annotations.push((
                                    reference.span.start,
                                    name.to_string(),
                                    declaration.body.span,
                                ));
                            }
                        }
                    }
                }
            }
        }

        walk::walk_ts_interface_declaration(self, declaration);
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        self.visit_named_body(function.id.as_ref().map(|id| id.name.as_str()), |check| {
            walk::walk_function(check, function, flags);
        });
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let name = declarator.id.get_binding_identifier().map(|identifier| identifier.name.as_str());
        let is_factory_arrow =
            matches!(&declarator.init, Some(Expression::ArrowFunctionExpression(_)) | Some(Expression::FunctionExpression(_)));

        if is_factory_arrow {
            self.visit_named_body(name, |check| walk::walk_variable_declarator(check, declarator));
        } else {
            walk::walk_variable_declarator(self, declarator);
        }
    }

    fn visit_new_expression(&mut self, expression: &NewExpression<'a>) {
        let Expression::Identifier(callee) = &expression.callee else {
            walk::walk_new_expression(self, expression);

            return;
        };

        let name = callee.name.as_str();

        // Only a field of an object literal built by an initial-data factory: anywhere else a Map
        // is somebody's cache, not a store's state. That containing-object-literal test is not
        // reproduced here in full — the factory-body test below is the load-bearing one, since
        // every value the library's own factories return is exactly such a literal.
        if UNTRACKABLE.contains(&name) && self.factory_depth > 0 {
            self.constructions.push((expression.span.start, name.to_string()));
        }

        walk::walk_new_expression(self, expression);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        let is_super_call = matches!(call.callee, Expression::Super(_));

        if is_super_call {
            self.factory_depth += 1;
        }

        walk::walk_call_expression(self, call);

        if is_super_call {
            self.factory_depth -= 1;
        }
    }

}

impl Check {
    /// Runs `walk` with `factory_depth` incremented when `name` matches the factory convention.
    fn visit_named_body(&mut self, name: Option<&str>, walk: impl FnOnce(&mut Self)) {
        let matches = name.is_some_and(is_factory_name);

        if matches {
            self.factory_depth += 1;
        }

        walk(self);

        if matches {
            self.factory_depth -= 1;
        }
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check {
        data_types: HashSet::new(),
        declarations: HashMap::new(),
        annotations: Vec::new(),
        constructions: Vec::new(),
        factory_depth: 0,
    };

    check.visit_program(program);

    let bodies: HashSet<Span> = check
        .data_types
        .iter()
        .filter_map(|name| check.declarations.get(name))
        .copied()
        .collect();

    let mut diagnostics: Vec<Diagnostic> = check
        .annotations
        .iter()
        .filter(|(_, _, body)| bodies.contains(body))
        .map(|(offset, name, _)| report(source, *offset, RULE, message(name)))
        .chain(
            check
                .constructions
                .iter()
                .map(|(offset, name)| report(source, *offset, RULE, message(name))),
        )
        .collect();

    diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    diagnostics
}

fn message(name: &str) -> String {
    format!(
        "{name} is not tracked field by field: reading it is one coarse leaf, and changing it in \
         place is invisible to the proxies, so the whole value — or the whole store — is invalidated \
         instead of what changed. snapshot() shares it by reference too, so undo will not restore it. \
         Keep plain objects and arrays in the store and convert at the edges."
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_map_field_in_a_stores_data_interface_is_reported() {
        let source = "interface IData {\n    index: Map<string, number>;\n}\n\n\
                      class Store extends Carburetor<IData> {}\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_plain_field_is_not_reported() {
        let source = "interface IData {\n    items: Record<string, number>;\n}\n\n\
                      class Store extends Carburetor<IData> {}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_map_built_by_an_initial_data_factory_is_reported() {
        let source = "function getInitialData() {\n    return {index: new Map()};\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_map_built_inside_super_is_reported() {
        let source = "class Store extends Carburetor {\n    constructor() {\n        \
                      super({index: new Map()});\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [3]);
    }

    #[test]
    fn a_map_that_is_somebody_elses_cache_is_left_alone() {
        let source = "class Cache {\n    constructor() {\n        this.entries = new Map();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_interface_unrelated_to_any_store_is_left_alone() {
        let source = "interface IOther {\n    index: Map<string, number>;\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
