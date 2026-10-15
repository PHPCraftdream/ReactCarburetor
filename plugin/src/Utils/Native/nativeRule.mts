import * as path from "node:path";
import {offsetAt} from "#src/Utils/Native/offsetAt.mts";
import {runNativeOnce} from "#src/Utils/Native/nativeBridge.mts";
import type {INativeRuleOptions, IRule, IRuleContext, IRuleMeta, TRuleVisitor} from "#src/Models.mts";

/**
 * A single-point report node. oxlint requires `range`; ESLint derives its message location from
 * `loc` instead and never computes one for a node its own parser did not produce, so a synthetic
 * node needs both — verified by running each host over the built plugin, not assumed from either
 * one's docs.
 */
/**
 * Which rule yields to which, when both cover the same spot, mirroring native's default dedup:
 * `no-function-in-render` (H31) yields to both allocation rules, `no-closure-in-update` (H32)
 * yields to `require-module-function` (H30).
 */
const OVERLAPS: Readonly<Record<string, readonly string[]>> = {
    'carburetor/no-function-in-render':
        ['carburetor/require-method-for-closure', 'carburetor/require-module-function'],
    'carburetor/no-closure-in-update': ['carburetor/require-module-function'],
};

interface IPointNode {
    type: 'Program';
    start: number;
    end: number;
    range: [number, number];
    loc: {start: {line: number; column: number}; end: {line: number; column: number}};
}


/** Rules each file's run had enabled, keyed by the shared `sourceCode` both hosts pass to every rule. */
const enabledRuns = new WeakMap<object, Set<string>>();

/**
 * Builds a rule that reports whatever the native binary already found for it.
 *
 * The binary runs once per lint run (see nativeBridge.mts); every rule this produces just reads
 * its own slice of that one result. `meta` is passed in rather than fixed here so each rule keeps
 * its own description. A rule that accepts options passes a `schema` for the host to validate
 * against and a `filter` that applies them: the binary always reports the full diagnostic set
 * (see nativeBridge.mts for why), so per-run options can only ever narrow a rule's slice here,
 * never change what the one shared run produced.
 *
 * The binary runs with `--keep-overlaps`, so diagnostics overlapping another rule's (an
 * allocation rule vs `no-function-in-render`) are not folded away natively. Each rule instead
 * yields its own overlap host-side: when the covering rule is actually enabled, its diagnostic
 * wins — matching native's default deduplication for hosts that disable either side.
 *
 * @param id - the rule id native reports under; a diagnostic belongs to this rule only when its
 * `rule` field matches
 * @param description - placed in `meta.docs.description` verbatim, so each produced rule presents
 * as its own rule to the host
 * @param options - the optional schema and diagnostic filter described above
 */
export const nativeRule = (id: string, description: string, options: INativeRuleOptions = {}): IRule => ({
    meta: {
        type: 'problem',
        docs: {description},
        ...(options.schema ? {schema: options.schema} : {}),
    } satisfies IRuleMeta,

    create(context: IRuleContext): TRuleVisitor {
        // Registration happens in `create`, so only rules the host enabled are recorded, and
        // before the AST walk — the set is complete by the time any `Program:exit` reads it.
        let enabled = enabledRuns.get(context.sourceCode);

        if (!enabled) {
            enabled = new Set<string>();
            enabledRuns.set(context.sourceCode, enabled);
        }

        enabled.add(id);

        return {
            'Program:exit'(): void {
                const diagnostics = runNativeOnce(process.cwd(), undefined, context.filename);
                const file = path.relative(process.cwd(), context.filename).replace(/\\/g, '/');
                const text = context.sourceCode.getText();
                const enabled = enabledRuns.get(context.sourceCode);

                diagnostics
                    // Native walks from `.`, so its paths carry a leading `./` that
                    // `path.relative()` never produces; strip it before comparing.
                    .filter((diagnostic) => diagnostic.file.replace(/^\.\//, '') === file && diagnostic.rule === id)
                    // Host options narrow the slice the one shared run produced; a rule without
                    // options keeps everything native found.
                    .filter((diagnostic) => options.filter?.(diagnostic, context.options) ?? true)
                    .filter((diagnostic) => {
                        const overlaps = OVERLAPS[id];

                        if (overlaps === undefined || !enabled) {
                            return true;
                        }

                        // An overlap only suppresses us when its rule is really enabled; otherwise
                        // this diagnostic would be lost, as native folds it away but the host
                        // hides the covering rule.
                        return !overlaps.some((overlap) =>
                            enabled.has(overlap) &&
                            diagnostics.some((other) =>
                                other.rule === overlap &&
                                other.file.replace(/^\.\//, '') === file &&
                                other.line === diagnostic.line &&
                                other.column === diagnostic.column));
                    })
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
