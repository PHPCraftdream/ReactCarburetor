/**
 * Types for the lint plugin.
 *
 * oxlint ships the full AST as types but does not export them (`oxlint/plugins-dev` exports
 * only `RuleTester`), and depending on ESLint would pull a linter into devDependencies for a
 * handful of interfaces. So this file declares the subset of the host API the rules actually
 * use. The shapes are the ones oxlint and ESLint v9 agree on, which is what lets one plugin
 * serve both hosts.
 */

/**
 * A node of the parsed file. The host builds the tree; rules only read it.
 *
 * `start` and `end` are on every node, and two nodes are compared through them rather than by
 * object identity: the host is free to hand a rule a fresh wrapper for the same node.
 */
export interface IAstNode {
    type: string;
    start: number;
    end: number;
    parent?: IAstNode | null;
}

/** `f(a, b)` — the argument count matters to more than one rule. */
export interface ICallExpressionNode extends IAstNode {
    type: 'CallExpression';
    callee: IAstNode;
    arguments: readonly IAstNode[];
}

/** `const x = init` — where a rule learns what a name is bound to. */
export interface IVariableDeclaratorNode extends IAstNode {
    type: 'VariableDeclarator';
    id: IAstNode;
    init: IAstNode | null;
}

/** `a = b` and its compound forms. */
export interface IAssignmentExpressionNode extends IAstNode {
    type: 'AssignmentExpression';
    left: IAstNode;
    right: IAstNode;
}

/** A class member: a method definition or a property definition. */
export interface IClassMemberNode extends IAstNode {
    key: IAstNode;
    static: boolean;
}

/** A function of any form; only the parameter list is of interest here. */
export interface IFunctionNode extends IAstNode {
    params: readonly IAstNode[];
}

/** `x++`, `--x`, `delete x`, `!x` — the operand is what a mutation rule looks at. */
export interface IOperatorNode extends IAstNode {
    operator: string;
    argument: IAstNode;
}

/**
 * Where a member chain starts.
 *
 * `this.draft.items[id].done` has `this` at its base and `draft` as the property taken from it,
 * which is how a rule tells `this.draft` apart from `this.data` without walking the chain itself.
 * `store.getData().items[id]` has the `getData()` call as its base.
 */
export interface IChainRoot {
    base: IAstNode;
    baseProperty: string | undefined;
}

/** An identifier, the node kind almost every rule has to look at. */
export interface IIdentifierNode extends IAstNode {
    type: 'Identifier';
    name: string;
}

/** A string, number or boolean literal. */
export interface ILiteralNode extends IAstNode {
    type: 'Literal';
    value: unknown;
}

/** `a.b` / `a['b']`, used to recognise member chains such as `this.draft.items`. */
export interface IMemberExpressionNode extends IAstNode {
    type: 'MemberExpression';
    object: IAstNode;
    property: IAstNode;
    computed: boolean;
}

/** The part of the host's fixer this plugin uses. */
export interface IRuleFixer {
    replaceText(node: IAstNode, text: string): unknown;
}

/** What a rule reports. A `fix` requires `meta.fixable` on the rule. */
export interface IDiagnostic {
    node: IAstNode;
    message: string;
    fix?: (fixer: IRuleFixer) => unknown;
}

/** The part of the host's source access this plugin uses. */
export interface ISourceCode {
    getText(node?: IAstNode): string;
}

/** The part of the host's rule context this plugin uses. */
export interface IRuleContext {
    /** Rule id in `<plugin>/<rule>` form. */
    id: string;
    filename: string;
    options: readonly unknown[];
    sourceCode: ISourceCode;
    report(diagnostic: IDiagnostic): void;
}

/** A handler per AST node type; a rule narrows the node itself. */
export type TRuleVisitor = Record<string, (node: IAstNode) => void>;

/** Rule metadata, as both hosts read it. */
export interface IRuleMeta {
    type?: 'problem' | 'suggestion' | 'layout';
    docs?: {
        description: string;
        url?: string;
    };
    schema?: readonly unknown[];
    fixable?: 'code' | 'whitespace';
}

/** A rule in the shape oxlint's `jsPlugins` and ESLint v9 flat config both accept. */
export interface IRule {
    meta?: IRuleMeta;
    create(context: IRuleContext): TRuleVisitor;
}

/** A shareable config, in the shape ESLint v9 flat config consumes. */
export interface IFlatConfig {
    plugins: Record<string, IPlugin>;
    rules: Readonly<Record<string, 'error' | 'warn' | 'off'>>;
}

/** The plugin object: what `jsPlugins` loads and what a flat config imports. */
export interface IPlugin {
    meta: {
        name: string;
        version?: string;
    };
    rules: Record<string, IRule>;
    configs?: Record<string, IFlatConfig>;
}
