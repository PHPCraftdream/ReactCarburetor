/**
 * Types for the packaged lint plugin.
 *
 * Hand-written rather than generated: the plugin ships as one bundled file, and declaring the two
 * shapes a consumer actually touches — the plugin object and its shareable config — is both smaller
 * and more honest than emitting declarations for every rule's internals.
 */

export type TSeverity = 'error' | 'warn' | 'off';

export interface ICarburetorRule {
    meta?: {
        type?: string;
        docs?: {description: string; url?: string};
        schema?: readonly unknown[];
        fixable?: string;
    };
    create(context: unknown): Record<string, (node: never) => void>;
}

export interface ICarburetorFlatConfig {
    plugins: {carburetor: ICarburetorPlugin};
    rules: Readonly<Record<string, TSeverity>>;
}

export interface ICarburetorPlugin {
    meta: {name: string; version?: string};
    rules: Record<string, ICarburetorRule>;
    configs: {recommended: ICarburetorFlatConfig};
}

declare const plugin: ICarburetorPlugin;

export default plugin;
