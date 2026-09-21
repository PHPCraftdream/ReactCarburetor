import * as path from "node:path";
import {offsetAt} from "#src/Utils/Native/offsetAt.mts";
import {runNativeOnce} from "#src/Utils/Native/nativeBridge.mts";
import type {IRule, IRuleContext, IRuleMeta, TRuleVisitor} from "#src/Models.mts";

/**
 * A single-point report node. oxlint requires `range`; ESLint derives its message location from
 * `loc` instead and never computes one for a node its own parser did not produce, so a synthetic
 * node needs both — verified by running each host over the built plugin, not assumed from either
 * one's docs.
 */
interface IPointNode {
    type: 'Program';
    start: number;
    end: number;
    range: [number, number];
    loc: {start: {line: number; column: number}; end: {line: number; column: number}};
}

/**
 * Builds a rule that reports whatever the native binary already found for it.
 *
 * The binary runs once per lint run (see nativeBridge.mts); every rule this produces just reads
 * its own slice of that one result. `meta` is passed in rather than fixed here so each rule keeps
 * its own description — the schema is dropped, though: native does not read options a JS host
 * would validate against one, and accepting options that silently do nothing is worse than
 * accepting none.
 */
export const nativeRule = (id: string, description: string): IRule => ({
    meta: {type: 'problem', docs: {description}} satisfies IRuleMeta,

    create(context: IRuleContext): TRuleVisitor {
        return {
            'Program:exit'(): void {
                const diagnostics = runNativeOnce(process.cwd());
                const file = path.relative(process.cwd(), context.filename).replace(/\\/g, '/');
                const text = context.sourceCode.getText();

                diagnostics
                    // Native walks from `.`, so its paths carry a leading `./` that
                    // `path.relative()` never produces; strip it before comparing.
                    .filter((diagnostic) => diagnostic.file.replace(/^\.\//, '') === file && diagnostic.rule === id)
                    .forEach((diagnostic) => {
                        const offset = offsetAt(text, diagnostic.line, diagnostic.column);
                        // ESLint's `loc.column` is 0-based; native's `diagnostic.column`, like
                        // oxlint's own, is 1-based.
                        const point = {line: diagnostic.line, column: diagnostic.column - 1};
                        const node: IPointNode = {
                            type: 'Program',
                            start: offset,
                            end: offset,
                            range: [offset, offset],
                            loc: {start: point, end: point},
                        };

                        context.report({node, message: diagnostic.message});
                    });
            },
        };
    },
});
