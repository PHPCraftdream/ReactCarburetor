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

/** A comment in the source, as `getCommentsBefore` hands it over. */
export interface ICommentNode extends IAstNode {
    type: 'Block' | 'Line';
    /** The text between the delimiters; rules read the raw text through `getText` instead. */
    value: string;
    /** Start and end as a pair, the form the host requires on anything reported or fixed. */
    range: [number, number];
}

/** The part of the host's source access this plugin uses. */
export interface ISourceCode {
    getText(node?: IAstNode): string;
    /** The comments between the previous token and `node`, in source order. */
    getCommentsBefore(node: IAstNode): readonly ICommentNode[];
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
