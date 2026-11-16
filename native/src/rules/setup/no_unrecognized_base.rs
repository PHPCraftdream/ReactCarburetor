//! A class that uses the engine through a base class the linter does not recognise.
//!
//! Recognition is syntactic: a class is a component or a store because of the name in its
//! `extends` clause, followed through classes declared in the same file. A project base imported
//! from another file (`class Screen extends AppComponent`) stops that walk, and every rule then
//! skips the class without a word until the base is listed in `componentBases` or `storeBases`.
//! This rule says so once per class, when the body plainly uses the engine: a component API called
//! on `this`, an effect hook declared, or a store's draft written.

use std::collections::HashSet;

use oxc_ast::ast::{
    Class, ClassElement, Expression, ImportDeclarationSpecifier, Program, Statement,
    StaticMemberExpression,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::property_key_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-unrecognized-base";

/// Members only a component calls on itself.
const COMPONENT_CALLS: &[&str] = &[
    "useCarburetor",
    "useComputed",
    "useResource",
    "suspendResource",
    "useEffect",
    "useStoreEffect",
    "useEvent",
];

/// Members only a component declares.
const COMPONENT_MEMBERS: &[&str] = &["useEffects", "unUseEffects"];

/// Members only a store uses on itself.
const STORE_CALLS: &[&str] = &["draft", "emitUpdate"];

/// The local names this file imports, the only names a base from another file can have here.
fn imported_names<'a>(program: &'a Program<'a>) -> HashSet<&'a str> {
    let mut names = HashSet::new();

    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };

        for specifier in import.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    names.insert(specifier.local.name.as_str());
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    names.insert(specifier.local.name.as_str());
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {}
            }
        }
    }

    names
}

/// What a class body shows it is, by what it uses on `this`.
#[derive(Default)]
struct Usage {
    component: bool,
    store: bool,
}

impl<'a> Visit<'a> for Usage {
    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        if matches!(member.object, Expression::ThisExpression(_)) {
            let name = member.property.name.as_str();

            self.component |= COMPONENT_CALLS.contains(&name);
            self.store |= STORE_CALLS.contains(&name);
        }

        walk::walk_static_member_expression(self, member);
    }

    // A nested class has a `this` of its own; what it uses says nothing about this one.
    fn visit_class(&mut self, _class: &Class<'a>) {}
}

/// One pass over one file.
struct Check<'s, 'a> {
    source: &'s Source<'s>,
    bases: &'s Bases,
    imported: HashSet<&'a str>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Visit<'a> for Check<'_, 'a> {
    fn visit_class(&mut self, class: &Class<'a>) {
        self.inspect(class);
        walk::walk_class(self, class);
    }
}

impl<'a> Check<'_, 'a> {
    /// Reports the class when it extends an imported, unlisted base and its body uses the engine.
    fn inspect(&mut self, class: &Class<'a>) {
        let Some(heritage) = &class.heritage else {
            return;
        };
        let Expression::Identifier(base) = &heritage.expression else {
            return;
        };
        let name = base.name.as_str();

        if !self.imported.contains(name)
            || self.bases.is_component(name)
            || self.bases.is_store(name)
        {
            return;
        }

        let mut usage = Usage::default();

        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if property_key_name(&method.key)
                    .is_some_and(|key| COMPONENT_MEMBERS.contains(&key))
                {
                    usage.component = true;
                }
            }
        }

        usage.visit_class_body(&class.body);

        let list = if usage.component {
            "componentBases"
        } else if usage.store {
            "storeBases"
        } else {
            return;
        };
        let subject = class
            .id
            .as_ref()
            .map_or_else(|| String::from("This class"), |id| format!("`{}`", id.name));
        let message = format!(
            "{subject} extends `{name}`, which the linter does not recognise as a carburetor base, \
             so no carburetor rule checks this class. Add \"{name}\" to {list} (settings.carburetor \
             in the lint config, or .carburetorrc.json)."
        );

        self.diagnostics.push(report(
            self.source,
            heritage.expression.span().start,
            RULE,
            message,
        ));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source<'_>, bases: &Bases) -> Vec<Diagnostic> {
    let imported = imported_names(program);

    if imported.is_empty() {
        return Vec::new();
    }

    let mut check = Check {
        source,
        bases,
        imported,
        diagnostics: Vec::new(),
    };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, diagnose_with, lines};

    #[test]
    fn an_imported_unlisted_base_with_component_calls_is_reported_once() {
        let source = concat!(
            "import {AppComponent} from './AppComponent';\n",
            "class Screen extends AppComponent {\n",
            "    render() { const view = this.useCarburetor(store); return view.title; }\n",
            "    protected useEffects() { this.useEffect('a', run, []); }\n",
            "}\n",
        );
        let found = diagnose(source, check);

        assert_eq!(lines(&found), [2]);
        assert!(found[0].message.contains("componentBases"));
        assert!(found[0].message.contains("`Screen` extends `AppComponent`"));
    }

    #[test]
    fn declaring_use_effects_alone_marks_a_component() {
        let source = concat!(
            "import {AppComponent} from './AppComponent';\n",
            "class Screen extends AppComponent {\n",
            "    protected useEffects() { start(); }\n",
            "}\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_store_base_is_named_as_a_store() {
        let source = concat!(
            "import {AppStore} from './AppStore';\n",
            "export class Cart extends AppStore {\n",
            "    add() { this.draft.count++; this.emitUpdate(); }\n",
            "}\n",
        );
        let found = diagnose(source, check);

        assert_eq!(lines(&found), [2]);
        assert!(found[0].message.contains("storeBases"));
    }

    #[test]
    fn a_listed_or_built_in_base_is_not_reported() {
        let listed = concat!(
            "import {AppComponent} from './AppComponent';\n",
            "class Screen extends AppComponent { render() { return this.useCarburetor(s); } }\n",
        );
        let bases = Bases::from_config(&[String::from("AppComponent")], &[]);

        assert!(diagnose_with(listed, &bases, check).is_empty());

        let built_in = concat!(
            "import {AntiHookComponent} from '@react-carburetor/core';\n",
            "class Screen extends AntiHookComponent { render() { return this.useCarburetor(s); } }\n",
        );

        assert!(diagnose(built_in, check).is_empty());
    }

    #[test]
    fn a_class_that_does_not_use_the_engine_is_not_reported() {
        let source = concat!(
            "import {Component} from 'react';\n",
            "import {Base} from './Base';\n",
            "class Plain extends Component { render() { return this.props.title; } }\n",
            "class Other extends Base { update() { this.draw(); } }\n",
        );

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn a_nested_class_and_an_unimported_base_do_not_count() {
        let source = concat!(
            "import {Base} from './Base';\n",
            "class Local {}\n",
            "class Outer extends Base {\n",
            "    make() { return class extends Local { m() { this.useCarburetor(s); } }; }\n",
            "}\n",
        );

        assert!(diagnose(source, check).is_empty());
    }
}
