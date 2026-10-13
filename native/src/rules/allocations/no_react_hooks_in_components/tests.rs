use super::*;
use crate::rules::support::testing::{diagnose, lines};

#[test]
fn named_react_aliases_are_reported_only_in_components() {
    let source = "import {useState as state, useMemo as memo} from 'react';\n\
        function utility() { return state(0); }\n\
        function Widget() {\n\
            const [value] = state(0);\n\
            return <p>{memo(() => value, [value])}</p>;\n\
        }";
    assert_eq!(lines(&diagnose(source, check)), [4, 5]);
}

#[test]
fn namespaces_aliases_and_literal_members_keep_react_provenance() {
    let source = "import * as R from 'react';\n\
        const Alias = R;\n\
        const ref = Alias.useRef;\n\
        const Widget = () => {\n\
            ref(null);\n\
            Alias['useEffect'](() => {}, []);\n\
            return <p/>;\n\
        };";
    assert_eq!(lines(&diagnose(source, check)), [5, 6]);
}

#[test]
fn local_shadowing_and_unrelated_use_named_functions_are_not_react() {
    let source = "import React, {useState} from 'react';\n\
        import {useEffect} from 'other-library';\n\
        function Widget(useState: (v: number) => number) {\n\
            useState(0); useEffect();\n\
            function Child(React: {useRef: () => void}) { React.useRef(); return <p/>; }\n\
            return <Child/>;\n\
        }";
    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn memo_forward_ref_and_anonymous_default_components_are_checked() {
    let source = "import {memo as wrap, forwardRef as forward, useId as id} from 'react';\n\
        const first = wrap(() => { id(); return null; });\n\
        const second = forward(function(props, ref) { id(); return null; });\n\
        export default () => { id(); return null; };";
    assert_eq!(lines(&diagnose(source, check)), [2, 3, 4]);
}

#[test]
fn jsx_returning_functions_and_react_use_are_checked() {
    let source = "import React from 'react';\n\
        const render = () => { React.use(resource); return <p/>; };\n\
        function widget() { React.useTransition(); if (visible) return <p/>; return null; }";
    assert_eq!(lines(&diagnose(source, check)), [2, 3]);
}

#[test]
fn class_component_react_hooks_do_not_confuse_instance_read_apis() {
    let source = "import React from 'react';\n\
        class Widget extends AntiHookComponent {\n\
            render() { React.useState(0); this.useCarburetor(store); return <p/>; }\n\
            helper() { this.useState(); }\n\
        }";
    assert_eq!(lines(&diagnose(source, check)), [3]);
}

#[test]
fn mutable_reassignment_type_imports_and_dynamic_members_are_not_guessed() {
    let source = "import React, {useState} from 'react';\n\
        import type {useRef} from 'react';\n\
        let state = useState; state = unrelated;\n\
        function Widget() { state(0); useRef(); React[method](); return <p/>; }";
    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn escaped_react_module_and_hook_names_preserve_import_identity() {
    let source = r"import {use\u0053tate as state} from '\u0072eact';
        function Widget() { state(0); return <p/>; }";
    assert_eq!(lines(&diagnose(source, check)), [2]);
}

#[test]
fn aliased_hook_diagnostics_point_to_the_exact_callee() {
    let source = r"import {useSyncExternalStore as read} from 'react';
function Widget() {
    read(subscribe, snapshot);
    return <p/>;
}";
    let rows = diagnose(source, check);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].rule, RULE);
    assert_eq!((rows[0].line, rows[0].column), (3, 5));
}

#[test]
fn commonjs_namespaces_and_destructured_react_bindings_are_checked() {
    let source = r"const React = require('react');
const {useState: state, useMemo: memo} = React;
function Widget() {
    state(0);
    memo(() => 1, []);
    React.useRef(null);
    return <p/>;
}";
    assert_eq!(lines(&diagnose(source, check)), [4, 5, 6]);
}

#[test]
fn a_locally_shadowed_require_is_not_assumed_to_load_react() {
    let source = r"function require(name) { return custom; }
const React = require('react');
function Widget() { React.useState(0); return <p/>; }";
    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn aliased_react_component_classes_preserve_component_ownership() {
    let source = r"import {Component as Base, useState} from 'react';
class Widget extends Base {
    render() { useState(0); return null; }
}";
    assert_eq!(lines(&diagnose(source, check)), [3]);
}
