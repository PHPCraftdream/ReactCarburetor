import {readFileSync} from "node:fs";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";
import {RECOMMENDED} from "@plugin/recommended.mts";

/**
 * Keeps the native binary's default severities equal to the JavaScript preset.
 *
 * The two implementations are one product, and strictness is the part a consumer notices first: if
 * the binary called a rule a warning where the plugin calls it an error, a project would pass or
 * fail depending on which of the two ran. Nothing else compares the tables, because they are written
 * in different languages — so this test reads the Rust source as text, which is ugly but is the only
 * check that fails when one side is edited alone.
 */
const ROOT: string = process.cwd();

const PREFIX = 'carburetor/';

/** The `DEFAULT_SEVERITIES` table in the Rust crate, as a map of bare rule name to severity. */
const nativeSeverities = (): Record<string, string> => {
    const source = readFileSync(path.join(ROOT, 'native', 'src', 'config.rs'), 'utf8');
    const table = /DEFAULT_SEVERITIES[^=]*=\s*&\[(.*?)\];/s.exec(source);

    expect(table, 'DEFAULT_SEVERITIES is still a slice literal in native/src/config.rs').not.toBeNull();

    const entries: Record<string, string> = {};

    for (const [, name, severity] of (table as RegExpExecArray)[1].matchAll(/\("([^"]+)",\s*Severity::(\w+)\)/g)) {
        entries[name] = severity.toLowerCase();
    }

    return entries;
};

/** The preset, keyed the way the Rust table keys it: by bare name. */
const presetSeverities = (): Record<string, string> => Object.fromEntries(
    Object.entries(RECOMMENDED).map(([rule, severity]) => [rule.replace(PREFIX, ''), severity]),
);

describe('native default severities', () => {
    test('match the JavaScript preset rule for rule', () => {
        expect(nativeSeverities()).toEqual(presetSeverities());
    });

    test('are written without the presentation prefix', () => {
        const prefixed = Object.keys(nativeSeverities()).filter((name) => name.startsWith(PREFIX));

        expect(prefixed).toEqual([]);
    });
});
