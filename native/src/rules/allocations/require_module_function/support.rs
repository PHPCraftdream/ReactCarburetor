use oxc_ast::ast::PropertyKey;

use crate::rules::support::bases::RENDER_METHODS;
use crate::rules::support::closures::{Candidate, Capture, Usage};

/// The members React itself calls on the instance by name, so a body that uses nothing from the
/// class is still not free to leave — the caller is React, not this file. `render` is covered by
/// `RENDER_METHODS`; these are the rest of the lifecycle and static hooks.
pub(super) const REACT_CALLED_MEMBERS: [&str; 8] = [
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
    "componentDidCatch",
    "getSnapshotBeforeUpdate",
    "getDerivedStateFromProps",
    "getDerivedStateFromError",
];

/// React's experimental lifecycle prefix — `UNSAFE_componentWillMount` and friends — treated the
/// same whatever the suffix says.
pub(super) const UNSAFE_PREFIX: &str = "UNSAFE_";

/// `AntiHookComponent`'s own override-point surface: the base class calls these as `this.<name>()`
/// internally, so a member with one of these names is not free to leave either. A name list rather
/// than a semantic override check, because resolving it properly would mean following the imported
/// base class into its own file — the cross-file resolution this crate deliberately stays out of.
/// A test below pins every name against the base class's own source, so a rename there fails here
/// instead of going stale.
pub(super) const BASE_SURFACE_MEMBERS: [&str; 15] = [
    "useEffects",
    "unUseEffects",
    "useEffect",
    "useCarburetor",
    "connect",
    "connectSelection",
    "useComputed",
    "useResource",
    "track",
    "loadStaleResources",
    "releaseEffects",
    "onCarburetorUpdate",
    "commitSubscriptions",
    "releaseSubscriptions",
    "releaseConnectionViews",
];

/// The name a class member is declared under, private names included — a `#helper` method is as
/// much a member as a public one, and D1 gives it no separate treatment.
pub(super) fn member_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::PrivateIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

/// Whether something this analysis cannot see calls the member by name: React, the component base,
/// or an interface contract. Visibility is not the boundary — extractability is.
pub(super) fn framework_called(name: &str) -> bool {
    RENDER_METHODS.contains(&name)
        || REACT_CALLED_MEMBERS.contains(&name)
        || BASE_SURFACE_MEMBERS.contains(&name)
        || name.starts_with(UNSAFE_PREFIX)
}

/// Whether the capture survives the extraction the rule asks for.
///
/// Same predicate `require-method-for-closure` applies, and the same reasoning: a this-derived
/// capture is re-read from `this`, so its usage does not matter — but a class-independent closure
/// cannot have one, since a this-derived capture is a class dependency by definition. Any other
/// capture has to be a never-written local, and even then only a directly-called helper can take
/// one: a callback's captures freeze at closure creation, where a module-level function's
/// parameters would not.
pub(super) fn passable(capture: &Capture<'_>, usage: &Usage<'_>) -> bool {
    capture.this_derived || matches!(usage, Usage::DirectHelper(_)) && !capture.written_after_init
}

/// The message for one class-independent closure: what the allocation costs, and where to put it.
pub(super) fn closure_message(candidate: &Candidate<'_>, member: Option<&str>) -> String {
    let cadence = if candidate.executes_in_render {
        String::from("on every render")
    } else {
        match member {
            Some(name) => format!("on every call of `{name}`"),
            None => String::from("on every call"),
        }
    };

    // A class-independent closure cannot be a pure forwarder — `() => this.m()` uses the class —
    // so there is no forwarder variant here to keep dead.
    debug_assert!(candidate.forwarder.is_none());

    let plain: Vec<&str> = candidate
        .captures
        .iter()
        .map(|capture| capture.name)
        .collect();

    if plain.is_empty() {
        return format!(
            "this closure uses nothing from the class and is rebuilt {cadence} — declare it once \
             at module level."
        );
    }

    let count = if plain.len() > 1 {
        "parameters"
    } else {
        "a parameter"
    };
    let quoted = plain
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "this closure uses nothing from the class and is rebuilt {cadence} — declare it once at \
         module level, taking {quoted} as {count}."
    )
}

/// The message for one class-independent member, by what it costs: a function-valued field is
/// rebuilt once per instance, a plain prototype method for nothing — but both sit in the class
/// without needing it.
pub(super) fn member_message(field_function: bool) -> String {
    if field_function {
        String::from(
            "this member is allocated once per instance but uses nothing from the class — declare \
             it once at module level, where one copy serves every instance.",
        )
    } else {
        String::from(
            "this method allocates nothing per instance but uses nothing from the class either — \
             it does not depend on the instance and belongs at module level.",
        )
    }
}
