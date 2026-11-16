import * as path from "node:path";
import {offsetAt} from "#src/Utils/Native/offsetAt.mts";
import {utf16FromByte} from "#src/Utils/utf16FromByte.mts";
import {runNative} from "#src/Utils/Native/nativeBridge.mts";
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

/** The options each file's rules were given in their own config entries, by bare rule name: every
 * rule of the file hands the same set to the bridge, so they all share one native run. */
const forwardedRuns = new WeakMap<object, Record<string, Record<string, unknown>>>();

/** Rules whose missing options were already reported in this process: once per run, not per file. */
const reportedMissing = new Set<string>();

/** The rule name the native config and `settings.carburetor.ruleOptions` key options by. */
const bareName = (id: string): string => id.replace(/^carburetor\//, '');

/** Whether a value is a plain options object, the only shape a rule's options entry can take. */
const isOptionsObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** The options `settings.carburetor.ruleOptions` gives one rule, if any.
 *
 * @param settings - the host's settings object
 * @param name - the bare rule name
 */
const settingsOptions = (
    settings: Record<string, unknown> | undefined,
    name: string,
): Record<string, unknown> | undefined => {
    const namespace = settings?.carburetor;
    const ruleOptions = isOptionsObject(namespace) ? namespace.ruleOptions : undefined;
    const options = isOptionsObject(ruleOptions) ? ruleOptions[name] : undefined;

    return isOptionsObject(options) ? options : undefined;
};

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
 * A rule that fixes passes `fixable: 'code'`, which the host reads from `meta.fixable`; when a
 * diagnostic then carries a `fix` — byte offsets native serialized, not string indices — the
 * boundaries are converted to UTF-16 indices with `utf16FromByte` and exposed as the host's
 * `fixer.replaceText` over a node spanning exactly that range. Diagnostics without a `fix`
 * report as before, and `fix` stays absent from the report.
 *
 * @param id - the rule id native reports under; a diagnostic belongs to this rule only when its
 * `rule` field matches
 * @param description - placed in `meta.docs.description` verbatim, so each produced rule presents
 * as its own rule to the host
 * @param options - the optional schema, diagnostic filter, and `fixable` described above
 */
export const nativeRule = (id: string, description: string, options: INativeRuleOptions = {}): IRule => ({
    meta: {
        type: 'problem',
        docs: {description},
        ...(options.schema ? {schema: options.schema} : {}),
        ...(options.fixable ? {fixable: options.fixable} : {}),
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

        const own = context.options[0];

        if (options.forwardOptions && isOptionsObject(own)) {
            let forwarded = forwardedRuns.get(context.sourceCode);

            if (!forwarded) {
                forwarded = {};
                forwardedRuns.set(context.sourceCode, forwarded);
            }

            forwarded[bareName(id)] = own;
        }

        return {
            'Program:exit'(): void {
                const text = context.sourceCode.getText();
                const forwarded = forwardedRuns.get(context.sourceCode);
                const diagnostics = runNative(
                    process.cwd(), undefined, context.filename, text, context.settings, forwarded,
                );

                // A rule switched on without what it needs would report nothing, which reads as a
                // clean result; it says so instead, once per run.
                if (options.missingOptions && !reportedMissing.has(id)) {
                    const missing = options.missingOptions(
                        forwarded?.[bareName(id)] ?? settingsOptions(context.settings, bareName(id)),
                    );

                    if (missing !== undefined) {
                        reportedMissing.add(id);
                        const start = {line: 1, column: 0};
                        const node: IPointNode = {
                            type: 'Program', start: 0, end: 0, range: [0, 0], loc: {start, end: start},
                        };

                        context.report({node, message: missing});
                    }
                }

                const file = path.relative(process.cwd(), context.filename).replace(/\\/g, '/');
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

                        const report: {
                            node: IPointNode;
                            message: string;
                            fix?: (fixer: import("#src/Models.mts").IRuleFixer) => unknown;
                        } = {node, message: diagnostic.message};

                        if (diagnostic.fix !== undefined) {
                            const start16 = utf16FromByte(text, diagnostic.fix.start);
                            const end16 = utf16FromByte(text, diagnostic.fix.end);
                            // Same node shape `report` needs: `range` for oxlint, `loc` for
                            // ESLint, both spanning exactly the fix.
                            const fixed: IPointNode = {
                                type: 'Program',
                                start: start16,
                                end: end16,
                                range: [start16, end16],
                                loc: node.loc,
                            };

                            report.fix = (fixer) => fixer.replaceText(fixed, diagnostic.fix!.text);
                        }

                        context.report(report);
                    });
            },
        };
    },
});
